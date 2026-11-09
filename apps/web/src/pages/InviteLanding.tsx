import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatUtc } from "../format";
import { phaseLabel, phasePillClass } from "../labels";
import "./invite.css";

interface InviteInfo {
  voteId: string;
  title: string;
  phase: string;
  expiresAt: string | null;
  accepted: boolean;
}

function inviteLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return "邀请不存在或已被移除。";
    if (error.status === 410) return error.message;
    return error.message;
  }
  return "邀请加载失败，请稍后重试。";
}

export default function InviteLanding() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isLoggedIn = Boolean(localStorage.getItem("token"));
  const encodedToken = encodeURIComponent(token);
  const returnPath = `/invite/${encodedToken}`;
  const loginHref = `/login?redirect=${encodeURIComponent(returnPath)}`;
  const registerHref = `/register?invite=${encodedToken}`;
  const accountHref = `/account?redirect=${encodeURIComponent(returnPath)}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");

    api
      .get<{ invite: InviteInfo }>(`/api/invites/${encodedToken}`)
      .then((data) => {
        if (!cancelled) setInvite(data.invite);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(inviteLoadError(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [encodedToken, reloadKey]);

  const handleAccept = async () => {
    setAcceptError("");
    setNeedsVerification(false);

    if (!localStorage.getItem("token")) {
      navigate(loginHref);
      return;
    }

    setAccepting(true);
    try {
      const data = await api.post<{ invite: { voteId: string } }>(
        `/api/invites/${encodedToken}/accept`
      );
      navigate(`/vote/${data.invite.voteId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem("token");
        navigate(loginHref);
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setNeedsVerification(true);
        setAcceptError("你的账号尚未通过实名核验，请先完成核验。");
        return;
      }
      if (error instanceof ApiError && (error.status === 409 || error.status === 410)) {
        // 邀请已被他人接受 / 投票已结束 / 已过期：重新拉取，让页面状态与错误一致。
        setAcceptError(error.message);
        setReloadKey((key) => key + 1);
        return;
      }
      setAcceptError(
        error instanceof ApiError
          ? error.message
          : "接受邀请失败，请稍后重试。"
      );
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="card">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card">
        <h1 className="page-title">无法打开邀请</h1>
        <div className="error" style={{ marginTop: "1rem" }}>
          {loadError}
        </div>
        <div className="invite-actions">
          <Link to="/" className="invite-action">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (!invite) return null;

  const ended = invite.phase === "ENDED";

  return (
    <div className="card">
      <p className="muted" style={{ marginBottom: "0.4rem" }}>
        投票邀请
      </p>
      <h1 className="page-title">{invite.title}</h1>

      <div className="stack" style={{ marginTop: "1rem" }}>
        <div className="row">
          <span className="muted">投票状态</span>
          <span className={phasePillClass(invite.phase)}>
            {phaseLabel(invite.phase)}
          </span>
        </div>
        <div className="row">
          <span className="muted">邀请有效期</span>
          <span>{invite.expiresAt ? formatUtc(invite.expiresAt) : "不过期"}</span>
        </div>
        <div className="row">
          <span className="muted">接受状态</span>
          <span>{invite.accepted ? "已接受" : "待接受"}</span>
        </div>
      </div>

      {ended && !invite.accepted && (
        <div className="invite-note invite-note--warn">
          这场投票已经结束，无法再接受邀请。
        </div>
      )}

      {invite.accepted && (
        <div className="invite-note">
          该邀请已被接受。只有接受者本人可以进入这场投票，其他人请联系发起人。
        </div>
      )}

      {!ended && !isLoggedIn && !invite.accepted && (
        <div className="invite-note">
          登录或注册后即可接受邀请，完成后会自动回到本页。
        </div>
      )}

      {acceptError && (
        <div className="error" style={{ marginTop: "1rem" }}>
          {acceptError}
          {needsVerification && (
            <>
              {" "}
              <Link to={accountHref} style={{ fontWeight: 600 }}>
                去完成核验
              </Link>
            </>
          )}
        </div>
      )}

      <div className="invite-actions">
        {invite.accepted ? (
          isLoggedIn ? (
            <button
              type="button"
              className="invite-action invite-action--primary"
              disabled={accepting}
              onClick={handleAccept}
            >
              {accepting ? "进入中…" : "我是接受者，进入投票"}
            </button>
          ) : (
            <Link
              to={loginHref}
              className="invite-action invite-action--primary"
            >
              登录查看
            </Link>
          )
        ) : isLoggedIn ? (
          !ended && (
            <button
              type="button"
              className="invite-action invite-action--primary"
              disabled={accepting}
              onClick={handleAccept}
            >
              {accepting ? "接受中…" : "接受邀请"}
            </button>
          )
        ) : (
          !ended && (
            <>
              <Link
                to={loginHref}
                className="invite-action invite-action--primary"
              >
                登录后接受
              </Link>
              <Link to={registerHref} className="invite-action">
                注册并接受
              </Link>
            </>
          )
        )}
        <Link to="/" className="invite-action">
          返回首页
        </Link>
      </div>
    </div>
  );
}
