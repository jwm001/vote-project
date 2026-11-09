import { useState } from "react";
import { useLocation, useSearchParams, Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { safePath } from "../navigation";

interface LoginResponse {
  token: string;
  user: { status: string };
}

export default function Login() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const destination = safePath(searchParams.get("redirect")) ?? "/";
  const notice = (location.state as { notice?: string } | null)?.notice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const data = await api.post<LoginResponse>("/api/auth/login", form);
      localStorage.setItem("token", data.token);
      // 整页跳转，让导航栏重新拉取 /api/auth/me。
      window.location.assign(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败，请稍后重试");
      setSubmitting(false);
    }
  };

  const registerHref =
    destination === "/"
      ? "/register"
      : `/register?redirect=${encodeURIComponent(destination)}`;

  return (
    <div
      style={{
        background: "white",
        borderRadius: "14px",
        padding: "2rem 1.6rem",
        boxShadow: "0 15px 50px rgba(0, 0, 0, 0.25)",
        maxWidth: "420px",
        margin: "2rem auto",
        border: "1px solid rgba(255, 255, 255, 0.2)",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "2.2rem", marginBottom: "0.4rem" }}>🔐</div>
        <h2 style={{ fontSize: "1.5rem", fontWeight: "700", marginBottom: "0.3rem" }}>
          欢迎回来
        </h2>
        <p style={{ color: "#666", fontSize: "0.85rem" }}>登录您的账号</p>
      </div>
      {notice && (
        <div
          style={{
            padding: "0.6rem 0.8rem",
            background: "#e6f7ec",
            color: "#1d7a3c",
            border: "1px solid #b7e4c7",
            borderRadius: "10px",
            marginBottom: "1rem",
            fontSize: "0.85rem",
          }}
        >
          {notice}
        </div>
      )}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "1rem" }}>
          <label>用户名</label>
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="请输入用户名"
            autoComplete="username"
            required
          />
        </div>
        <div style={{ marginBottom: "1.2rem" }}>
          <label>密码</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="请输入密码"
            autoComplete="current-password"
            required
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{ width: "100%", fontSize: "0.9rem", padding: "0.75em" }}
        >
          {submitting ? "登录中…" : "登录"}
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
        还没有账号？{" "}
        <Link to={registerHref} style={{ fontWeight: "600" }}>
          立即注册
        </Link>
      </p>
    </div>
  );
}
