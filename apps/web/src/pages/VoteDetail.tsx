import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface Option {
  id: string;
  text: string;
  order: number;
}

interface Vote {
  id: string;
  title: string;
  description?: string;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
  options: Option[];
}

export default function VoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vote, setVote] = useState<Vote | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [user, setUser] = useState<any>(null);
  const [hasVoted, setHasVoted] = useState(false);

  useEffect(() => {
    fetchVote();
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.ok ? res.json() : null)
        .then(data => data && setUser(data.user));
      fetch(`/api/votes/${id}/has-voted`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.ok ? res.json() : { hasVoted: false })
        .then(data => setHasVoted(data.hasVoted))
        .catch(() => {});
    }
  }, [id]);

  const fetchVote = async () => {
    try {
      const res = await fetch(`/api/votes/${id}`);
      if (res.ok) {
        const data = await res.json();
        setVote(data.vote);
      }
    } catch (error) {
      console.error("Failed to fetch vote", error);
    }
  };

  const handleSelectOption = (optionId: string) => {
    if (!vote || hasVoted) return;
    if (vote.allowMultiple) {
      if (selectedOptions.includes(optionId)) {
        setSelectedOptions(selectedOptions.filter((o) => o !== optionId));
      } else {
        setSelectedOptions([...selectedOptions, optionId]);
      }
    } else {
      setSelectedOptions([optionId]);
    }
  };

  const handleSubmit = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("请先登录");
      navigate("/login");
      return;
    }
    if (user?.status !== 'APPROVED') {
      alert("需要实名认证审核通过才能投票");
      return;
    }
    if (hasVoted) {
      alert("您已投过此票");
      return;
    }
    if (selectedOptions.length === 0) {
      alert("请选择选项");
      return;
    }

    try {
      const res = await fetch(`/api/votes/${id}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ optionIds: selectedOptions }),
      });

      if (res.ok) {
        alert("投票成功，正在下载全量记录PDF...");
        try {
          const pdfRes = await fetch(`/api/votes/${id}/audit/pdf`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (pdfRes.ok) {
            const blob = await pdfRes.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `audit-${id}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }
        } catch (e) {
          console.error('PDF下载失败', e);
        }
        setHasVoted(true);
        fetchVote();
      } else {
        const data = await res.json();
        alert(data.error || "投票失败");
      }
    } catch (error) {
      alert("投票失败");
    }
  };

  if (!vote) {
    return <div style={{ background: 'white', borderRadius: '12px', padding: '2rem', textAlign: 'center', fontSize: '0.9rem' }}>加载中...</div>;
  }

  return (
    <div style={{
      background: 'white',
      borderRadius: '14px',
      padding: '1.8rem 1.5rem',
      boxShadow: '0 15px 50px rgba(0, 0, 0, 0.25)',
      maxWidth: '700px',
      margin: '1rem auto',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    }}>
      <h1 style={{ marginBottom: '0.5rem', fontSize: '1.6rem', fontWeight: '700' }}>{vote.title}</h1>
      {vote.description && <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem', lineHeight: '1.6' }}>{vote.description}</p>}
      <div style={{ display: 'flex', gap: '0.8rem', color: '#666', fontSize: '0.8rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <span style={{ padding: '0.2rem 0.6rem', background: '#f0f1ff', borderRadius: '6px', color: '#667eea' }}>{vote.allowMultiple ? '多选' : '单选'}</span>
        <span>🕐 {new Date(vote.startAt).toLocaleString()} - {new Date(vote.endAt).toLocaleString()}</span>
      </div>
      <h3 style={{ marginBottom: '0.9rem', fontSize: '1.1rem', fontWeight: '600' }}>选择选项</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
        {vote.options.sort((a, b) => a.order - b.order).map(option => (
          <div
            key={option.id}
            onClick={() => handleSelectOption(option.id)}
            style={{
              padding: '0.9rem 1.2rem',
              border: selectedOptions.includes(option.id) ? '2px solid #667eea' : '2px solid #e8e8e8',
              borderRadius: '10px',
              cursor: hasVoted ? 'not-allowed' : 'pointer',
              background: selectedOptions.includes(option.id) ? '#f8f9ff' : hasVoted ? '#f9f9f9' : 'white',
              opacity: hasVoted ? 0.6 : 1,
              transition: 'all 0.2s ease',
              fontWeight: selectedOptions.includes(option.id) ? '600' : '400',
              fontSize: '0.9rem'
            }}
          >
            {vote.allowMultiple ? (selectedOptions.includes(option.id) ? '☑️' : '⬜') : (selectedOptions.includes(option.id) ? '🔘' : '⚪')} {option.text}
          </div>
        ))}
      </div>
      {user?.status !== 'APPROVED' && (
        <p style={{ color: '#e74c3c', marginBottom: '0.8rem', textAlign: 'center', fontSize: '0.85rem' }}>
          ⚠️ 您的实名认证尚未审核通过，暂无法投票
        </p>
      )}
      {hasVoted && (
        <div style={{ background: '#f0fdf4', padding: '0.9rem', borderRadius: '10px', marginBottom: '0.9rem', textAlign: 'center' }}>
          <p style={{ color: '#27ae60', fontWeight: '600', marginBottom: '0.3rem', fontSize: '0.9rem' }}>
            ✅ 您已投过此票
          </p>
          <p style={{ color: '#666', fontSize: '0.8rem' }}>
            可在"我的投票"中查看您的假名和下载全量记录
          </p>
        </div>
      )}
      {hasVoted ? (
        <button onClick={async () => {
          const token = localStorage.getItem('token');
          try {
            const pdfRes = await fetch(`/api/votes/${id}/audit/pdf`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (pdfRes.ok) {
              const blob = await pdfRes.blob();
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `audit-${id}.pdf`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);
            }
          } catch(e) {}
        }} style={{ width: '100%', fontSize: '0.9rem', padding: '0.75em' }}>
          下载全量记录PDF
        </button>
      ) : (
        <button onClick={handleSubmit} style={{ width: '100%', fontSize: '0.9rem', padding: '0.75em' }} disabled={user?.status !== 'APPROVED'}>
          提交投票（投票后将自动下载全量记录PDF）
        </button>
      )}
    </div>
  );
}
