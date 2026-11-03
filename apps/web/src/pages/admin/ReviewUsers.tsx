import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: string;
  username: string;
  realName: string;
  idNumber: string;
  idCardImages: string[];
  status: string;
  createdAt: string;
}

export default function ReviewUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.user?.role !== 'ADMIN') {
          alert('需要管理员权限');
          navigate('/');
        } else {
          fetchUsers(token);
        }
      });
  }, []);

  const fetchUsers = async (token: string) => {
    try {
      const res = await fetch('/api/admin/pending', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleReview = async (userId: string, action: 'approve' | 'reject') => {
    const token = localStorage.getItem('token');
    try {
      const res = await fetch(`/api/admin/${userId}/${action === 'approve' ? 'approve' : 'reject'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        alert(action === 'approve' ? '审核通过' : '审核拒绝');
        fetchUsers(token!);
      }
    } catch (e) {
      alert('操作失败');
    }
  };

  return (
    <div>
      <h1 style={{ color: 'white', marginBottom: '2rem', fontSize: '2rem' }}>实名认证审核</h1>
      <div style={{ display: 'grid', gap: '1.5rem' }}>
        {users.map(u => (
          <div key={u.id} style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)'
          }}>
            <h2 style={{ marginBottom: '1rem' }}>{u.realName} (@{u.username})</h2>
            <p style={{ marginBottom: '0.5rem', color: '#666' }}>身份证号：{u.idNumber}</p>
            <p style={{ marginBottom: '1rem', color: '#666' }}>注册时间：{new Date(u.createdAt).toLocaleString()}</p>
            <div style={{ marginBottom: '1rem' }}>
              <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>身份证照片：</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {u.idCardImages?.map((img, idx) => (
                  <a key={idx} href={`/api/admin/uploads/${img}`} target="_blank" rel="noopener noreferrer">
                    <img src={`/api/admin/uploads/${img}`} alt={`身份证${idx+1}`} style={{ width: '200px', height: '150px', objectFit: 'cover', borderRadius: '8px', border: '2px solid #e0e0e0' }} />
                  </a>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => handleReview(u.id, 'approve')}>通过</button>
              <button onClick={() => handleReview(u.id, 'reject')} style={{ background: '#e74c3c' }}>拒绝</button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', textAlign: 'center', color: '#666' }}>
            暂无待审核用户
          </div>
        )}
      </div>
    </div>
  );
}
