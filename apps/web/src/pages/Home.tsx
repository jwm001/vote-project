import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div style={{
      background: 'white',
      borderRadius: '16px',
      padding: '2rem 1.5rem',
      boxShadow: '0 20px 60px rgba(0, 0, 0, 0.25)',
      textAlign: 'center',
      maxWidth: '900px',
      margin: '1.5rem auto',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>🗳️</div>
      <h1 style={{
        fontSize: '2rem',
        marginBottom: '0.6rem',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        fontWeight: '800',
        letterSpacing: '-0.5px'
      }}>
        防作弊投票系统
      </h1>
      <p style={{ fontSize: '1rem', color: '#666', marginBottom: '2rem', lineHeight: '1.6', fontWeight: '500' }}>
        准入实名 · 投票匿名 · 全量可审计
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
        textAlign: 'left'
      }}>
        <div style={{ 
          padding: '1.2rem', 
          background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f1ff 100%)', 
          borderRadius: '12px',
          border: '1px solid rgba(102, 126, 234, 0.2)'
        }}>
          <div style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>🔐</div>
          <h3 style={{ color: '#667eea', marginBottom: '0.4rem', fontSize: '1rem' }}>准入实名</h3>
          <p style={{ color: '#555', fontSize: '0.8rem', lineHeight: '1.5' }}>需提交真实信息并通过管理员审核</p>
        </div>
        <div style={{ 
          padding: '1.2rem', 
          background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f1ff 100%)', 
          borderRadius: '12px',
          border: '1px solid rgba(102, 126, 234, 0.2)'
        }}>
          <div style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>🎭</div>
          <h3 style={{ color: '#667eea', marginBottom: '0.4rem', fontSize: '1rem' }}>投票匿名</h3>
          <p style={{ color: '#555', fontSize: '0.8rem', lineHeight: '1.5' }}>每次投票生成新假名，记录与 PDF 中不含实名信息</p>
        </div>
        <div style={{ 
          padding: '1.2rem', 
          background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f1ff 100%)', 
          borderRadius: '12px',
          border: '1px solid rgba(102, 126, 234, 0.2)'
        }}>
          <div style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>📄</div>
          <h3 style={{ color: '#667eea', marginBottom: '0.4rem', fontSize: '1rem' }}>全量可审计</h3>
          <p style={{ color: '#555', fontSize: '0.8rem', lineHeight: '1.5' }}>投票后强制下载全量记录，可校验是否被改动</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/votes"><button style={{ fontSize: '0.9rem', padding: '0.7em 1.8em' }}>浏览投票</button></Link>
        <Link to="/register"><button style={{ fontSize: '0.9rem', padding: '0.7em 1.8em', background: 'white', color: '#667eea', border: '2px solid #667eea', boxShadow: 'none' }}>立即注册</button></Link>
      </div>
    </div>
  );
}
