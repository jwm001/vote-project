import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { api, ApiError } from "../api";
import { safePath } from "../navigation";
import { formatUtc } from "../format";

interface AccountUser {
  id: string;
  username: string;
  status: string;
  role: string;
  realName: string;
  identityVerifiedAt: string | null;
}

function statusLabel(status: string): string {
  if (status === "APPROVED") return "已实名通过";
  if (status === "PENDING_VERIFICATION") return "待核验";
  return status;
}

export default function Account() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [reverifyForm, setReverifyForm] = useState({
    realName: "",
    idNumber: "",
  });
  const [reverifyError, setReverifyError] = useState("");
  const [reverifyNotice, setReverifyNotice] = useState("");
  const [reverifying, setReverifying] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirect = safePath(searchParams.get("redirect"));
  const notice = (location.state as { notice?: string } | null)?.notice;
  const loginNext = redirect
    ? `/account?redirect=${encodeURIComponent(redirect)}`
    : "/account";
  const loginUrl = `/login?redirect=${encodeURIComponent(loginNext)}`;

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      navigate(loginUrl, { replace: true });
      return;
    }

    api
      .get<{ user: AccountUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem("token");
          navigate(loginUrl, { replace: true });
          return;
        }
        setLoadError("账号信息加载失败，请刷新重试");
      })
      .finally(() => setLoading(false));
  }, [navigate, loginUrl]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordNotice("");

    if (passwordForm.newPassword.length < 6) {
      setPasswordError("新密码至少 6 位");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }

    setSavingPassword(true);
    try {
      const data = await api.post<{ user: AccountUser }>(
        "/api/auth/change-password",
        {
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }
      );
      setUser(data.user);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordNotice("密码已修改");
    } catch (err) {
      setPasswordError(
        err instanceof ApiError ? err.message : "修改失败，请稍后重试"
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const handleReverify = async (e: React.FormEvent) => {
    e.preventDefault();
    setReverifyError("");
    setReverifyNotice("");

    setReverifying(true);
    try {
      const data = await api.post<{ user: AccountUser }>(
        "/api/auth/reverify",
        reverifyForm
      );
      setUser(data.user);
      setReverifyForm({ realName: "", idNumber: "" });
      if (redirect) {
        // 从邀请 / 投票入口过来的，核验完成后直接回到原流程。
        window.location.assign(redirect);
        return;
      }
      setReverifyNotice("实名核验已通过");
    } catch (err) {
      setReverifyError(
        err instanceof ApiError ? err.message : "核验失败，请稍后重试"
      );
    } finally {
      setReverifying(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ maxWidth: "560px" }}>
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card" style={{ maxWidth: "560px" }}>
        <div className="error">{loadError}</div>
        <Link to="/">返回首页</Link>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="card" style={{ maxWidth: "560px" }}>
      <h1 className="page-title">账号设置</h1>

      {notice && (
        <div
          style={{
            padding: "0.7rem 0.9rem",
            background: "#fff6dd",
            color: "#8a6400",
            border: "1px solid #ffe8a3",
            borderRadius: "10px",
            fontSize: "0.88rem",
            marginBottom: "1.25rem",
          }}
        >
          {notice}
        </div>
      )}

      <div className="stack" style={{ marginBottom: "1.75rem" }}>
        <div className="row">
          <span className="muted">用户名</span>
          <strong>{user.username}</strong>
        </div>
        <div className="row">
          <span className="muted">实名状态</span>
          <span
            className={`pill${
              user.status === "APPROVED" ? " pill--live" : " pill--draft"
            }`}
          >
            {statusLabel(user.status)}
          </span>
        </div>
        <div className="row">
          <span className="muted">核验时间</span>
          <span>{formatUtc(user.identityVerifiedAt)}</span>
        </div>
      </div>

      {user.status === "PENDING_VERIFICATION" && (
        <section style={{ marginBottom: "1.75rem" }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: "0.4rem" }}>
            重新核验实名
          </h2>
          <p className="muted" style={{ marginBottom: "0.9rem" }}>
            上次核验时服务不可用。请填写真实姓名和身份证号重试。
          </p>
          <form onSubmit={handleReverify}>
            <div style={{ marginBottom: "0.9rem" }}>
              <label>真实姓名 *</label>
              <input
                value={reverifyForm.realName}
                onChange={(e) =>
                  setReverifyForm({ ...reverifyForm, realName: e.target.value })
                }
                placeholder="请输入身份证上的姓名"
                required
              />
            </div>
            <div style={{ marginBottom: "0.9rem" }}>
              <label>身份证号 *</label>
              <input
                value={reverifyForm.idNumber}
                onChange={(e) =>
                  setReverifyForm({ ...reverifyForm, idNumber: e.target.value })
                }
                placeholder="18 位大陆居民身份证号"
                autoCapitalize="characters"
                autoComplete="off"
                required
              />
            </div>
            {reverifyError && <div className="error">{reverifyError}</div>}
            {reverifyNotice && (
              <div className="muted" style={{ marginBottom: "0.9rem" }}>
                {reverifyNotice}
              </div>
            )}
            <button type="submit" disabled={reverifying}>
              {reverifying ? "核验中…" : "重新核验"}
            </button>
          </form>
        </section>
      )}

      <section>
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.9rem" }}>
          修改密码
        </h2>
        <form onSubmit={handleChangePassword}>
          <div style={{ marginBottom: "0.9rem" }}>
            <label>当前密码 *</label>
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  currentPassword: e.target.value,
                })
              }
              autoComplete="current-password"
              required
            />
          </div>
          <div style={{ marginBottom: "0.9rem" }}>
            <label>新密码 *</label>
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  newPassword: e.target.value,
                })
              }
              placeholder="至少 6 位"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label>确认新密码 *</label>
            <input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) =>
                setPasswordForm({
                  ...passwordForm,
                  confirmPassword: e.target.value,
                })
              }
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          {passwordError && <div className="error">{passwordError}</div>}
          {passwordNotice && (
            <div className="muted" style={{ marginBottom: "0.9rem" }}>
              {passwordNotice}
            </div>
          )}
          <button type="submit" disabled={savingPassword}>
            {savingPassword ? "保存中…" : "修改密码"}
          </button>
        </form>
      </section>
    </div>
  );
}
