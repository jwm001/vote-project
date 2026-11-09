import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { safePath } from "../navigation";

interface RegisterResponse {
  user: { status: string };
  token: string;
}

export default function Register() {
  const [form, setForm] = useState({
    username: "",
    password: "",
    realName: "",
    idNumber: "",
    consent: false,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const inviteToken = searchParams.get("invite");
  const redirect = safePath(searchParams.get("redirect"));
  // 邀请优先：注册完直接回到邀请落地页；否则用显式 redirect；默认去登录。
  const destination = inviteToken
    ? `/invite/${encodeURIComponent(inviteToken)}`
    : redirect ?? "/login";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.consent) {
      setError("请先同意实名核验");
      return;
    }

    setSubmitting(true);
    try {
      const data = await api.post<RegisterResponse>("/api/auth/register", {
        username: form.username,
        password: form.password,
        realName: form.realName,
        idNumber: form.idNumber,
      });

      if (data.user.status === "PENDING_VERIFICATION") {
        // 核验服务不可用时账号已建好，带上 token 去账号页手动重验。
        localStorage.setItem("token", data.token);
        const next =
          destination === "/login"
            ? "/account"
            : `/account?redirect=${encodeURIComponent(destination)}`;
        navigate(next, {
          state: { notice: "实名核验服务暂不可用，账号已创建，稍后可重试" },
        });
        return;
      }

      navigate(destination, {
        state:
          destination === "/login" ? { notice: "注册成功，请登录" } : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "注册失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: "white",
        borderRadius: "14px",
        padding: "2rem 1.6rem",
        boxShadow: "0 15px 50px rgba(0, 0, 0, 0.25)",
        maxWidth: "460px",
        margin: "1.5rem auto",
        border: "1px solid rgba(255, 255, 255, 0.2)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "2.2rem", marginBottom: "0.4rem" }}>📝</div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: "700", marginBottom: "0.3rem" }}>
          实名注册
        </h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          注册即完成二要素实名核验
        </p>
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "0.9rem" }}>
          <label>用户名 *</label>
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="请输入用户名"
            autoComplete="username"
            required
          />
        </div>
        <div style={{ marginBottom: "0.9rem" }}>
          <label>密码 *</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="请输入密码（至少 6 位）"
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
        <div style={{ marginBottom: "0.9rem" }}>
          <label>真实姓名 *</label>
          <input
            value={form.realName}
            onChange={(e) => setForm({ ...form, realName: e.target.value })}
            placeholder="请输入身份证上的姓名"
            autoComplete="name"
            required
          />
        </div>
        <div style={{ marginBottom: "0.9rem" }}>
          <label>身份证号 *</label>
          <input
            value={form.idNumber}
            onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
            placeholder="18 位大陆居民身份证号"
            autoCapitalize="characters"
            autoComplete="off"
            required
          />
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            fontWeight: 400,
            fontSize: "0.82rem",
            color: "#555",
            marginBottom: "1.2rem",
            lineHeight: 1.5,
          }}
        >
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(e) => setForm({ ...form, consent: e.target.checked })}
            style={{ width: "auto", marginTop: "0.2rem" }}
          />
          <span>
            我同意使用真实姓名和身份证号进行实名核验。身份证号仅保存摘要，姓名加密保存。
          </span>
        </label>
        {error && <div className="error">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{ width: "100%", fontSize: "0.9rem", padding: "0.75em" }}
        >
          {submitting ? "核验中…" : "注册"}
        </button>
      </form>
      <p
        style={{
          textAlign: "center",
          marginTop: "1.2rem",
          color: "#666",
          fontSize: "0.85rem",
        }}
      >
        已有账号？ <Link to="/login" style={{ fontWeight: "600" }}>立即登录</Link>
      </p>
    </div>
  );
}
