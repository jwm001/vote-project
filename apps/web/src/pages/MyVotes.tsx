import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './MyVotes.css';

interface MyVote {
  voteId: string;
  voteTitle: string;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
  pseudonym: string | null;
  submittedAt: string;
  sequenceNumber: number;
}

type LoadState = 'loading' | 'ready' | 'error';

function getStatus(startAt: string, endAt: string) {
  const now = Date.now();
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (now < start) return { key: 'upcoming', label: '未开始' } as const;
  if (now > end) return { key: 'ended', label: '已结束' } as const;
  return { key: 'live', label: '进行中' } as const;
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRange(startAt: string, endAt: string) {
  const format = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  return `${format(startAt)} — ${format(endAt)}`;
}

export default function MyVotes() {
  const [votes, setVotes] = useState<MyVote[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [needLogin, setNeedLogin] = useState(() => !localStorage.getItem('token'));
  const [reloadKey, setReloadKey] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string>>({});
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setNeedLogin(true);
      setState('ready');
      return;
    }
    setNeedLogin(false);
    setState('loading');
    setError('');
    let cancelled = false;

    fetch('/api/votes/my/votes', { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        if (!res.ok) throw new Error('request failed');
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setVotes(Array.isArray(data.votes) ? data.votes : []);
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setError('加载失败，请检查网络后重试');
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const copyPseudonym = async (text: string, voteId: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      document.body.removeChild(helper);
    }
    setCopiedId(voteId);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedId(null), 1800);
  };

  const downloadPdf = async (voteId: string) => {
    const token = localStorage.getItem('token');
    setDownloadingId(voteId);
    setPdfErrors(prev => {
      if (!prev[voteId]) return prev;
      const next = { ...prev };
      delete next[voteId];
      return next;
    });

    try {
      const res = await fetch(`/api/votes/${voteId}/audit/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('download failed');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-${voteId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      setPdfErrors(prev => ({ ...prev, [voteId]: 'PDF 下载失败，请重试' }));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div>
      <header className="mv-head">
        <div>
          <h1 className="mv-title">我的投票记录</h1>
          <p className="mv-sub">
            {state === 'ready' && !needLogin
              ? `共 ${votes.length} 场 · 投票身份完全匿名`
              : '准入实名 · 投票匿名 · 全量可审计'}
          </p>
        </div>
        <Link className="mv-browse" to="/votes">
          浏览投票
        </Link>
      </header>

      {needLogin && (
        <div className="mv-panel">
          <div className="mv-panel-icon">🔒</div>
          <h2 className="mv-panel-title">请先登录</h2>
          <p className="mv-panel-text">登录后可查看你的投票记录、匿名假名与全量记录 PDF。</p>
          <Link className="mv-cta" to="/login">
            去登录
          </Link>
        </div>
      )}

      {!needLogin && state === 'loading' && (
        <div className="mv-list" aria-busy="true" aria-label="正在加载投票记录">
          {[0, 1, 2].map(index => (
            <div className="mv-skeleton" key={index}>
              <div className="mv-sk mv-sk--seq" />
              <div className="mv-sk-lines">
                <div className="mv-sk mv-sk--title" />
                <div className="mv-sk mv-sk--meta" />
                <div className="mv-sk mv-sk--pseudo" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!needLogin && state === 'error' && (
        <div className="mv-panel">
          <div className="mv-panel-icon">⚠️</div>
          <h2 className="mv-panel-title">记录加载失败</h2>
          <p className="mv-panel-text">{error}</p>
          <button onClick={() => setReloadKey(key => key + 1)}>重新加载</button>
        </div>
      )}

      {!needLogin && state === 'ready' && votes.length === 0 && (
        <div className="mv-panel">
          <div className="mv-panel-icon">🗳️</div>
          <h2 className="mv-panel-title">还没有投票记录</h2>
          <p className="mv-panel-text">参与一场投票后，你的匿名假名和全量记录会出现在这里。</p>
          <Link className="mv-cta" to="/votes">
            去看看有哪些投票
          </Link>
        </div>
      )}

      {!needLogin && state === 'ready' && votes.length > 0 && (
        <div className="mv-list">
          {votes.map(vote => {
            const status = getStatus(vote.startAt, vote.endAt);
            const pseudonym = vote.pseudonym;
            return (
              <article className="mv-card" key={vote.voteId}>
                <div className="mv-seq" title="本场全量记录中的排序号">
                  <span className="mv-seq-label">No.</span>
                  <span className="mv-seq-value">{vote.sequenceNumber}</span>
                </div>

                <div className="mv-body">
                  <div className="mv-title-row">
                    <Link className="mv-vote-title" to={`/vote/${vote.voteId}`}>
                      {vote.voteTitle}
                    </Link>
                    <span className={`mv-status mv-status--${status.key}`}>
                      {status.key === 'live' && <span className="mv-dot" />}
                      {status.label}
                    </span>
                  </div>

                  <div className="mv-meta">
                    <span className="mv-chip">{vote.allowMultiple ? '多选' : '单选'}</span>
                    <span>🕐 投票于 {formatDateTime(vote.submittedAt)}</span>
                    <span>📅 投票期 {formatRange(vote.startAt, vote.endAt)}</span>
                  </div>

                  <div className="mv-pseudonym">
                    <span className="mv-pseudo-label">匿名假名</span>
                    {pseudonym ? (
                      <>
                        <code className="mv-pseudo-value">{pseudonym}</code>
                        <button
                          type="button"
                          className="mv-copy"
                          onClick={() => copyPseudonym(pseudonym, vote.voteId)}
                        >
                          {copiedId === vote.voteId ? '已复制' : '复制'}
                        </button>
                      </>
                    ) : (
                      <span className="mv-pseudo-value mv-pseudo-value--empty">记录缺失</span>
                    )}
                  </div>

                  {pdfErrors[vote.voteId] && (
                    <p className="mv-error" role="alert">
                      {pdfErrors[vote.voteId]}
                    </p>
                  )}
                </div>

                <div className="mv-actions">
                  <Link className="mv-btn mv-btn--primary" to={`/vote/${vote.voteId}`}>
                    查看详情
                  </Link>
                  <button
                    type="button"
                    className="mv-btn mv-btn--ghost"
                    onClick={() => downloadPdf(vote.voteId)}
                    disabled={downloadingId === vote.voteId}
                  >
                    {downloadingId === vote.voteId ? '下载中…' : '下载 PDF'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!needLogin && votes.length > 0 && (
        <p className="mv-footnote">
          序号是该场投票全量记录 PDF 中的排序号；本页不展示任何实名信息。
        </p>
      )}
    </div>
  );
}
