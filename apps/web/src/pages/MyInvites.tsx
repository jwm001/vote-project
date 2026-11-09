import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatUtc } from "../format";
import {
  inviteStatusLabel,
  inviteStatusPillClass,
  phaseLabel,
  phasePillClass,
} from "../labels";
import type { MyInviteItem } from "../types";
import "./invite.css";

type LoadState = "loading" | "ready" | "error";

export default function MyInvites() {
  const navigate = useNavigate();

  const [invites, setInvites] = useState<MyInviteItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [needLogin, setNeedLogin] = useState(
    () => !localStorage.getItem("token")
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      setNeedLogin(true);
      setState("ready");
      return;
    }

    setNeedLogin(false);
    setState("loading");
    setLoadError("");
    let cancelled = false;

    api
      .get<{ invites: MyInviteItem[] }>("/api/votes/my/invites")
      .then((data) => {
        if (cancelled) return;
        setInvites(Array.isArray(data.invites) ? data.invites : []);
        setState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          localStorage.removeItem("token");
          setNeedLogin(true);
          setState("ready");
          return;
        }
        setLoadError(
          error instanceof ApiError
            ? error.message
            : "加载失败，请检查网络后重试。"
        );
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleAccept = async (invite: MyInviteItem) => {
    setActionError("");
    setNeedsVerification(false);
    setAcceptingId(invite.inviteId);

    try {
      const data = await api.post<{ invite: { voteId: string } }>(
        `/api/votes/my/invites/${encodeURIComponent(invite.inviteId)}/accept`
      );
      navigate(`/vote/${data.invite.voteId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem("token");
        setNeedLogin(true);
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setNeedsVerification(true);
        setActionError("你的账号尚未通过实名核验，请先完成核验。");
        return;
      }
      if (error instanceof ApiError && (error.status === 409 || error.status === 410)) {
        // 邀请已被他人接受 / 投票已结束 / 已过期：重新拉取列表，避免状态与错误矛盾。
        setActionError(error.message);
        setReloadKey((key) => key + 1);
        return;
      }
      setActionError(
        error instanceof ApiError ? error.message : "接受邀请失败，请稍后重试。"
      );
    } finally {
      setAcceptingId(null);
    }
  };

  if (needLogin) {
    return (
      <div className="card">
        <h1 className="page-title">我的邀请</h1>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          登录后查看你收到的投票邀请。
        </p>
        <div className="invite-actions">
          <Link
            to="/login?redirect=/my-invites"
            className="invite-action invite-action--primary"
          >
            登录
          </Link>
          <Link to="/register" className="invite-action">
            注册
          </Link>
        </div>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="card">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="card">
        <h1 className="page-title">我的邀请</h1>
        <div className="error" style={{ marginTop: "1rem" }}>
          {loadError}
        </div>
        <div className="invite-actions">
          <button
            type="button"
            className="invite-action invite-action--primary"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            重试
          </button>
          <Link to="/" className="invite-action">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h1 className="page-title">我的邀请</h1>
      <p className="muted" style={{ marginTop: "0.4rem" }}>
        共 {invites.length} 条邀请
      </p>

      {actionError && (
        <div className="error" style={{ marginTop: "1rem" }}>
          {actionError}
          {needsVerification && (
            <>
              {" "}
              <Link
                to="/account?redirect=/my-invites"
                style={{ fontWeight: 600 }}
              >
                去完成核验
              </Link>
            </>
          )}
        </div>
      )}

      {invites.length === 0 ? (
        <div className="invite-note" style={{ marginTop: "1.5rem" }}>
          暂无邀请。收到邀请链接后，打开链接即可接受。
        </div>
      ) : (
        <div className="invite-list">
          {invites.map((invite) => {
            const canAccept =
              invite.status === "INVITED" && invite.phase !== "ENDED";

            return (
              <div className="invite-item" key={invite.inviteId}>
                <div className="invite-item-main">
                  {invite.status === "ACCEPTED" ? (
                    <Link
                      to={`/vote/${invite.voteId}`}
                      className="invite-item-title"
                    >
                      {invite.voteTitle}
                    </Link>
                  ) : (
                    <div className="invite-item-title">{invite.voteTitle}</div>
                  )}
                  <div className="invite-item-meta">
                    <span>发起人 {invite.creatorUsername || "—"}</span>
                    <span className={inviteStatusPillClass(invite.status)}>
                      {inviteStatusLabel(invite.status)}
                    </span>
                    <span className={phasePillClass(invite.phase)}>
                      {phaseLabel(invite.phase)}
                    </span>
                    <span>
                      有效期{" "}
                      {invite.expiresAt ? formatUtc(invite.expiresAt) : "不过期"}
                    </span>
                  </div>
                </div>
                <div className="invite-item-actions">
                  {canAccept && (
                    <button
                      type="button"
                      className="invite-action invite-action--primary"
                      disabled={acceptingId === invite.inviteId}
                      onClick={() => handleAccept(invite)}
                    >
                      {acceptingId === invite.inviteId ? "接受中…" : "接受"}
                    </button>
                  )}
                  {invite.status === "ACCEPTED" && (
                    <Link
                      to={`/vote/${invite.voteId}`}
                      className="invite-action"
                    >
                      进入投票
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
