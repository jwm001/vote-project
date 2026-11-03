import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface MyVote {
  voteId: string;
  voteTitle: string;
  pseudonym: string;
  submittedAt: string;
  sequenceNumber: number;
}

export default function MyVotes() {
  const [votes, setVotes] = useState<MyVote[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/votes/my/votes', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json())
        .then(data => setVotes(data.votes || []));
    }
  }, []);

  const downloadPdf = async (voteId: string) => {
    const token = localStorage.getItem('token');
    try {
      const pdfRes = await fetch(`/api/votes/${voteId}/audit/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (pdfRes.ok) {
        const blob = await pdfRes.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-${voteId}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch(e) {}
  };

  return (
    <div>
      <h1 style={{ color: 'white', marginBottom: '1.5rem', fontSize: '1.6rem', fontWeight: '700' }}>我的投票记录</h1>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {votes.map(v => (
          <div key={v.voteId} style={{
            background: 'white',
            borderRadius: '12px',
            padding: '1.2rem 1.4rem',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(102, 126, 234, 0.1)'
          }}>
            <h2 style={{ marginBottom: '0.8rem', fontSize: '1.2rem', fontWeight: '600' }}>{v.voteTitle}</h2>
            <div style={{ display: 'grid', gap: '0.4rem', marginBottom: '1rem', color: '#666', fontSize: '0.85rem' }}>
              <div>🎭 假名：<strong style={{ color: '#667eea' }}>{v.pseudonym}</strong></div>
              <div>📝 序号：{v.sequenceNumber}</div>
              <div>🕐 时间：{new Date(v.submittedAt).toLocaleString()}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <Link to={`/vote/${v.voteId}`}><button style={{ padding: '0.5em 1em', fontSize: '0.85em' }}>查看详情</button></Link>
              <button onClick={() => downloadPdf(v.voteId)} style={{ padding: '0.5em 1em', fontSize: '0.85em', background: 'white', color: '#667eea', border: '1.5px solid #667eea', boxShadow: 'none' }}>下载PDF</button>
            </div>
          </div>
        ))}
        {votes.length === 0 && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', textAlign: 'center', color: '#666', fontSize: '0.9rem' }}>
            暂无投票记录
          </div>
        )}
      </div>
    </div>
  );
}
