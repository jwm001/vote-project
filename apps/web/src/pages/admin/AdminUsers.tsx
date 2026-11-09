import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api";
import { formatUtc } from "../../format";
import "./AdminUsers.css";

interface AdminUser {
  id: string;
  username: string;
  realName: string;
  status: string;
  identityVerificationRef: string | null;
  identityVerifiedAt: string | null;
  createdAt: string;
}

interface ResetResult {
  user: AdminUser;
  temporaryPassword: string;
}

type PageState = "loading" | "ready" | "denied" | "error";

function statusLabel(status: string): string {
  if (status === "APPROVED") return "已核验";
  if (status === "PENDING_VERIFICATION") return "待核验";
  return status;
}

function statusClass(status: string): string {
  if (status === "APPROVED") return "au-status au-status--ok";
  if (status === "PENDING_VERIFICATION") return "au-status au-status--pending";
  return "au-status";
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState("");
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadUsers = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const data = await api.get<{ users: AdminUser[] }>("/api/admin/users");
      setUsers(Array.isArray(data.users) ? data.users : []);
      setState("ready");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "用户列表加载失败，请稍后重试。"
      );
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("token")) {
      navigate("/login?redirect=/admin/users", { replace: true });
      return;
    }

    let cancelled = false;
    api
      .get<{ user: { role: string } }>("/api/auth/me")
      .then((data) => {
        if (cancelled) return;
        if (data.user.role !== "ADMIN") {
          setState("denied");
          return;
        }
        void loadUsers();
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem("token");
          navigate("/login?redirect=/admin/users", { replace: true });
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "权限校验失败，请稍后重试。"
        );
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [loadUsers, navigate]);

  const resetPassword = async (user: AdminUser) => {
    if (
      !window.confirm(
        `确定将「${user.username}」的密码重置为一次性临时密码吗？`
      )
    ) {
      return;
    }

    setResettingId(user.id);
    setActionError("");
    setCopied(false);
    try {
      const result = await api.post<{ temporaryPassword: string }>(
        `/api/admin/users/${user.id}/reset-password`
      );
      setResetResult({ user, temporaryPassword: result.temporaryPassword });
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "重置失败，请稍后重试。"
      );
    } finally {
      setResettingId(null);
    }
  };

  const copyPassword = async () => {
    if (!resetResult) return;
    try {
      await navigator.clipboard.writeText(resetResult.temporaryPassword);
      setCopied(true);
    } catch {
      /* 浏览器不支持剪贴板时，用户可手动全选复制 */
    }
  };

  if (state === "denied") {
    return (
      <div className="card">
        <h1 className="page-title">需要管理员权限</h1>
        <p className="muted">当前账号无权查看用户列表。</p>
        <p>
          <Link to="/">返回首页</Link>
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="card">
        <h1 className="page-title">用户管理</h1>
        <div className="error" style={{ marginTop: "1rem" }}>
          {error}
        </div>
        <div className="au-actions" style={{ marginTop: "1rem" }}>
          <button type="button" onClick={() => void loadUsers()}>
            重试
          </button>
          <Link className="au-link-button" to="/">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="au-page">
      <header className="au-head">
        <div>
          <h1 className="au-title">用户管理</h1>
          <p className="au-sub">
            {state === "ready" ? `共 ${users.length} 位用户 · 只读核验信息` : "正在加载…"}
          </p>
        </div>
      </header>

      {actionError && <div className="au-alert au-alert--error">{actionError}</div>}

      {state === "loading" ? (
        <div className="au-card">
          <p className="muted">用户列表加载中…</p>
        </div>
      ) : users.length === 0 ? (
        <div className="au-card">
          <p className="muted">暂无用户。</p>
        </div>
      ) : (
        <div className="au-card au-table-wrap">
          <table className="au-table">
            <thead>
              <tr>
                <th scope="col">用户名</th>
                <th scope="col">姓名</th>
                <th scope="col">状态</th>
                <th scope="col">核验时间</th>
                <th scope="col">注册时间</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="au-username">@{user.username}</td>
                  <td>{user.realName || "—"}</td>
                  <td>
                    <span className={statusClass(user.status)}>
                      {statusLabel(user.status)}
                    </span>
                  </td>
                  <td className="au-time">
                    {formatUtc(user.identityVerifiedAt)}
                  </td>
                  <td className="au-time">{formatUtc(user.createdAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="au-inline-button"
                      onClick={() => void resetPassword(user)}
                      disabled={resettingId === user.id}
                    >
                      {resettingId === user.id ? "重置中…" : "重置密码"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resetResult && (
        <div className="au-modal-backdrop">
          <div
            className="au-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="au-modal-title"
          >
            <h2 id="au-modal-title" className="au-modal-title">
              临时密码已生成
            </h2>
            <p className="au-modal-text">
              请把下面的一次性临时密码交给「{resetResult.user.username}
              」。关闭后无法再次查看，用户登录后应立即修改密码。
            </p>
            <div className="au-password-row">
              <code className="au-password">
                {resetResult.temporaryPassword}
              </code>
              <button type="button" className="au-inline-button" onClick={() => void copyPassword()}>
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <div className="au-modal-actions">
              <button
                type="button"
                className="au-primary"
                onClick={() => setResetResult(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
