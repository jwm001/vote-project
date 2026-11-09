import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useState, useEffect } from "react";
import { api } from "./api";
import "./App.css";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import CreateVote from "./pages/CreateVote";
import VoteDetail from "./pages/VoteDetail";
import MyVotes from "./pages/MyVotes";
import MyInvites from "./pages/MyInvites";
import Account from "./pages/Account";
import InviteLanding from "./pages/InviteLanding";
import AdminUsers from "./pages/admin/AdminUsers";

interface NavUser {
  username: string;
  status: string;
  role: string;
}

function Nav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<NavUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // 路由变化时重新拉取，保证注册/登录后无需整页刷新导航栏状态。
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      return;
    }

    api
      .get<{ user: NavUser }>("/api/auth/me")
      .then((data) => setUser(data.user))
      .catch(() => {});
  }, [location.pathname]);

  const closeMenu = () => setMenuOpen(false);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
    closeMenu();
    navigate("/");
  };

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-brand" onClick={closeMenu}>
          🗳️ VoteSecure
        </Link>
        <button
          type="button"
          className="nav-toggle"
          aria-label="打开菜单"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ☰
        </button>
        <div className={`nav-links${menuOpen ? " nav-links--open" : ""}`}>
          <Link to="/my-votes" className="nav-link" onClick={closeMenu}>
            我的投票
          </Link>
          <Link to="/my-invites" className="nav-link" onClick={closeMenu}>
            我的邀请
          </Link>
          {user?.status === "APPROVED" && (
            <Link to="/create" className="nav-link" onClick={closeMenu}>
              创建投票
            </Link>
          )}
          {user?.role === "ADMIN" && (
            <Link to="/admin/users" className="nav-link" onClick={closeMenu}>
              用户管理
            </Link>
          )}
          {user ? (
            <div className="nav-user">
              <Link to="/account" onClick={closeMenu}>
                {user.username}
              </Link>
              <span
                className={`nav-badge${
                  user.status === "APPROVED" ? "" : " nav-badge--pending"
                }`}
              >
                {user.status === "APPROVED" ? "已实名 ✓" : "待核验 ⏳"}
              </span>
              <button
                type="button"
                className="nav-logout"
                onClick={handleLogout}
              >
                退出
              </button>
            </div>
          ) : (
            <>
              <Link to="/login" className="nav-link" onClick={closeMenu}>
                登录
              </Link>
              <Link to="/register" onClick={closeMenu}>
                <button type="button" className="nav-logout">
                  注册
                </button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <Router>
      <Nav />
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "0 0.8rem 1.5rem" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/my-votes" element={<MyVotes />} />
          <Route path="/my-invites" element={<MyInvites />} />
          <Route path="/invite/:token" element={<InviteLanding />} />
          <Route path="/create" element={<CreateVote />} />
          <Route path="/vote/:id" element={<VoteDetail />} />
          <Route path="/account" element={<Account />} />
          <Route path="/admin/users" element={<AdminUsers />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
