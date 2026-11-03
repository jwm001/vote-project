import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import VoteList from './pages/VoteList';
import CreateVote from './pages/CreateVote';
import VoteDetail from './pages/VoteDetail';
import AdminReview from './pages/admin/ReviewUsers';
import MyVotes from './pages/MyVotes';

function Nav() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => data && setUser(data.user))
        .catch(() => {});
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    navigate('/');
    setMenuOpen(false);
  };

  return (
    <nav style={{
      background: 'rgba(255, 255, 255, 0.98)',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05), 0 10px 40px rgba(102, 126, 234, 0.15)',
      padding: '0.6rem 0.8rem',
      marginBottom: '1.5rem',
      borderBottom: '1px solid rgba(102, 126, 234, 0.1)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        <Link to="/" style={{
          fontSize: '1.4rem',
          fontWeight: '800',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px'
        }}>
          🗳️ VoteSecure
        </Link>
        <button 
          onClick={() => setMenuOpen(!menuOpen)}
          style={{ 
            display: window.innerWidth < 768 ? 'block' : 'none',
            padding: '0.4em 0.8em',
            fontSize: '0.9em',
            background: 'white',
            color: '#667eea',
            boxShadow: 'none',
            border: '1px solid #667eea'
          }}
        >
          ☰
        </button>
        <div style={{ 
          display: window.innerWidth < 768 ? (menuOpen ? 'flex' : 'none') : 'flex',
          flexDirection: window.innerWidth < 768 ? 'column' : 'row',
          gap: window.innerWidth < 768 ? '0.8rem' : '1.5rem',
          alignItems: window.innerWidth < 768 ? 'flex-start' : 'center',
          width: window.innerWidth < 768 ? '100%' : 'auto',
          marginTop: window.innerWidth < 768 ? '0.8rem' : '0',
          padding: window.innerWidth < 768 ? '0.5rem 0' : '0'
        }}>
          <Link to="/votes" style={{ color: '#333', fontWeight: '500', fontSize: '0.9rem' }} onClick={() => setMenuOpen(false)}>投票列表</Link>
          {user && <Link to="/my-votes" style={{ color: '#333', fontWeight: '500', fontSize: '0.9rem' }} onClick={() => setMenuOpen(false)}>我的投票</Link>}
          {user?.status === 'APPROVED' && <Link to="/create" style={{ color: '#333', fontWeight: '500', fontSize: '0.9rem' }} onClick={() => setMenuOpen(false)}>创建投票</Link>}
          {user?.role === 'ADMIN' && <Link to="/admin/review" style={{ color: '#333', fontWeight: '500', fontSize: '0.9rem' }} onClick={() => setMenuOpen(false)}>实名认证审核</Link>}
          {user ? (
            <>
              <div style={{ 
                padding: '0.3rem 0.7rem', 
                background: user.status === 'APPROVED' ? 'linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%)' : 'linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%)',
                borderRadius: '20px',
                fontSize: '0.8rem',
                fontWeight: '600',
                color: user.status === 'APPROVED' ? '#155724' : '#856404'
              }}>
                {user.realName} {user.status === 'APPROVED' ? '✓' : '⏳'}
              </div>
              <button onClick={handleLogout} style={{ padding: '0.4em 1em', fontSize: '0.85em' }}>
                退出
              </button>
            </>
          ) : (
            <>
              <Link to="/login" style={{ color: '#333', fontWeight: '500', fontSize: '0.9rem' }} onClick={() => setMenuOpen(false)}>登录</Link>
              <Link to="/register" onClick={() => setMenuOpen(false)}><button style={{ padding: '0.4em 1em', fontSize: '0.85em' }}>注册</button></Link>
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
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 0.8rem 1.5rem' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/votes" element={<VoteList />} />
          <Route path="/my-votes" element={<MyVotes />} />
          <Route path="/create" element={<CreateVote />} />
          <Route path="/vote/:id" element={<VoteDetail />} />
          <Route path="/admin/review" element={<AdminReview />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
