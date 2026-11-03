import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface Vote {
  id: string;
  title: string;
  description?: string;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
}

export default function VoteList() {
  const [votes, setVotes] = useState<Vote[]>([]);

  useEffect(() => {
    fetch('/api/votes')
      .then(res => res.json())
      .then(data => setVotes(data.votes || []))
      .catch(() => {});
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.8rem' }}>
        <h1 style={{ color: 'white', fontSize: '1.6rem', fontWeight: '700' }}>投票列表</h1>
        <Link to="/create"><button style={{ padding: '0.6em 1.4em', fontSize: '0.9em' }}>+ 创建投票</button></Link>
      </div>
      <div style={{ display: 'grid', gap: '1rem' }}>
        {votes.map(vote => (
          <Link key={vote.id} to={`/vote/${vote.id}`} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '1.2rem 1.4rem',
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.2)',
              transition: 'all 0.2s ease',
              cursor: 'pointer',
              border: '1px solid rgba(102, 126, 234, 0.1)'
            }}
            onMouseOver={e => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 12px 40px rgba(102, 126, 234, 0.3)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.2)';
            }}>
              <h2 style={{ marginBottom: '0.4rem', color: '#1a1a1a', fontSize: '1.2rem', fontWeight: '600' }}>{vote.title}</h2>
              {vote.description && <p style={{ color: '#666', marginBottom: '0.8rem', fontSize: '0.9rem', lineHeight: '1.5' }}>{vote.description}</p>}
              <div style={{ display: 'flex', gap: '1rem', color: '#666', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                <span style={{ padding: '0.2rem 0.6rem', background: '#f0f1ff', borderRadius: '6px', color: '#667eea' }}>{vote.allowMultiple ? '多选' : '单选'}</span>
                <span>🕐 {new Date(vote.startAt).toLocaleDateString()} - {new Date(vote.endAt).toLocaleDateString()}</span>
              </div>
            </div>
          </Link>
        ))}
        {votes.length === 0 && (
          <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', textAlign: 'center', color: '#666', fontSize: '0.9rem' }}>
            暂无投票活动
          </div>
        )}
      </div>
    </div>
  );
}
