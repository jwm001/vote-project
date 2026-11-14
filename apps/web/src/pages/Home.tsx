import { Link } from "react-router-dom";
import "./Home.css";

export default function Home() {
  // 首页不需要额外请求：本地有无 token 就足够决定显示哪组入口。
  const isLoggedIn = Boolean(localStorage.getItem("token"));

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-emoji">🗳️</div>
        <h1 className="home-title">发起或参与一场投票</h1>
        <p className="home-subtitle">实名核验 · 投票匿名 · 全量可审计</p>
        <div className="home-actions">
          {isLoggedIn ? (
            <>
              <Link to="/create" className="home-action home-action--primary">
                创建投票
              </Link>
              <Link to="/hall" className="home-action">
                投票大厅
              </Link>
              <Link to="/my-votes" className="home-action">
                我的投票
              </Link>
              <Link to="/my-invites" className="home-action">
                我的邀请
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="home-action home-action--primary">
                登录
              </Link>
              <Link to="/register" className="home-action">
                注册
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="home-features">
        <div className="home-feature">
          <div className="home-feature-icon">🔐</div>
          <h3>实名核验</h3>
          <p>注册时在线核验姓名与身份证号。</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">🎭</div>
          <h3>投票匿名</h3>
          <p>投票记录不含实名，每次投票生成新假名。</p>
        </div>
        <div className="home-feature">
          <div className="home-feature-icon">📄</div>
          <h3>全量可审计</h3>
          <p>投票结束后可下载全量记录并校验摘要。</p>
        </div>
      </section>
    </div>
  );
}
