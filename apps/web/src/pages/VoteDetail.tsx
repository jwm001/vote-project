import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { formatUtc } from "../format";
import { phaseLabel, phasePillClass } from "../labels";
import ShareCard from "../components/ShareCard";
import ResultsPanel from "../components/ResultsPanel";
import RosterPanel from "../components/RosterPanel";
import InvitePanel from "../components/InvitePanel";
import type {
  ResultsView,
  RosterView,
  VoteDetailView,
  VoteOptionView,
} from "../types";
import "./VoteDetail.css";

interface LoadError {
  message: string;
  kind: "forbidden" | "missing" | "other";
}

function timingText(vote: VoteDetailView): string {
  if (vote.participationMode === "INVITE_ONLY" && vote.phase === "DRAFT") {
    return vote.durationMinutes
      ? `投票时长 ${vote.durationMinutes} 分钟（开始后计时）`
      : "开始后计时";
  }
  return `${formatUtc(vote.startAt)} — ${formatUtc(vote.endAt)}`;
}

export default function VoteDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [vote, setVote] = useState<VoteDetailView | null>(null);
  const [results, setResults] = useState<ResultsView | null>(null);
  const [roster, setRoster] = useState<RosterView | null>(null);
  const [viewerStatus, setViewerStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [notice, setNotice] = useState("");

  const loginHref = `/login?redirect=${encodeURIComponent(`/vote/${id}`)}`;
  const accountHref = `/account?redirect=${encodeURIComponent(`/vote/${id}`)}`;

  const load = useCallback(async () => {
    if (!id) return;

    if (!localStorage.getItem("token")) {
      navigate(loginHref, { replace: true });
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const data = await api.get<{ vote: VoteDetailView }>(`/api/votes/${id}`);
      setVote(data.vote);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        localStorage.removeItem("token");
        navigate(loginHref, { replace: true });
        return;
      }
      setLoadError({
        message:
          error instanceof ApiError
            ? error.message
            : "投票加载失败，请稍后重试。",
        kind:
          error instanceof ApiError && error.status === 403
            ? "forbidden"
            : error instanceof ApiError && error.status === 404
              ? "missing"
              : "other",
      });
      setLoading(false);
      return;
    }

    const [me, resultsData, rosterData] = await Promise.allSettled([
      api.get<{ user: { status: string } }>("/api/auth/me"),
      api.get<ResultsView>(`/api/votes/${id}/results`),
      api.get<RosterView>(`/api/votes/${id}/roster`),
    ]);

    if (me.status === "fulfilled") {
      setViewerStatus(me.value.user.status);
    }
    setResults(resultsData.status === "fulfilled" ? resultsData.value : null);
    setRoster(rosterData.status === "fulfilled" ? rosterData.value : null);
    setLoading(false);
  }, [id, loginHref, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelected([]);
    setSubmitError("");
    setNotice("");
    setDownloadError("");
  }, [id]);

  const handleSelect = (option: VoteOptionView) => {
    if (!vote?.canVote) return;

    if (!vote.allowMultiple) {
      setSelected([option.id]);
      return;
    }

    setSelected((previous) => {
      if (previous.includes(option.id)) {
        return previous.filter((selectedId) => selectedId !== option.id);
      }
      if (option.isAbstain) {
        // 弃权与其它选项互斥。
        return [option.id];
      }
      const abstainId = vote.options.find((item) => item.isAbstain)?.id;
      const withoutAbstain = abstainId
        ? previous.filter((selectedId) => selectedId !== abstainId)
        : previous;
      return [...withoutAbstain, option.id];
    });
  };

  const downloadPdf = async () => {
    setDownloadError("");
    try {
      await api.download(`/api/votes/${id}/audit/pdf`, `audit-${id}.pdf`);
    } catch {
      setDownloadError("PDF 下载失败，请重试");
    }
  };

  const handleSubmit = async () => {
    if (!vote?.canVote || selected.length === 0 || submitting) return;

    setSubmitting(true);
    setSubmitError("");
    setDownloadError("");
    setNotice("");

    try {
      await api.post(`/api/votes/${id}/submit`, { optionIds: selected });
      setSelected([]);
      setNotice("投票成功。");
      // 投票成功后必须下载本场全量记录；失败只提示重试，不撤销投票结果。
      await downloadPdf();
      await load();
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : "投票失败，请稍后重试。"
      );
      if (error instanceof ApiError && error.status === 409) {
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !vote) {
    return (
      <div className="card">
        <p className="muted">加载中…</p>
      </div>
    );
  }

  if (loadError) {
    const title =
      loadError.kind === "forbidden"
        ? "无法查看投票"
        : loadError.kind === "missing"
          ? "投票不存在"
          : "加载失败";
    return (
      <div className="card">
        <h1 className="page-title">{title}</h1>
        <div className="error" style={{ marginTop: "1rem" }}>
          {loadError.message}
        </div>
        <div className="vd-actions">
          {loadError.kind === "other" && (
            <button type="button" onClick={() => void load()}>
              重试
            </button>
          )}
          <Link to="/" className="vd-link-button">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (!vote) return null;

  const sortedOptions = [...vote.options].sort((a, b) => a.order - b.order);
  const isModeB = vote.participationMode === "INVITE_ONLY";
  const unverified = viewerStatus !== "" && viewerStatus !== "APPROVED";
  const unacceptedInvite =
    isModeB &&
    vote.phase === "LIVE" &&
    vote.isInvitee &&
    !vote.hasVoted &&
    !vote.canVote &&
    !unverified &&
    !vote.isCreator;

  return (
    <div className="vd-card">
      <header className="vd-head">
        <div className="vd-pills">
          <span className="pill">
            {isModeB ? "邀请制" : "公开链接"}
          </span>
          <span className={phasePillClass(vote.phase)}>
            {phaseLabel(vote.phase)}
          </span>
          <span className="pill">{vote.allowMultiple ? "多选" : "单选"}</span>
        </div>
        <h1 className="page-title">{vote.title}</h1>
        {vote.description && <p className="vd-desc">{vote.description}</p>}
        <p className="vd-time">{timingText(vote)}</p>
        <p className="vd-counts">
          已投 {vote.votedCount}
          {vote.eligibleCount !== null && ` / ${vote.eligibleCount}`} 人
        </p>
      </header>

      {!isModeB && (
        <div className="vd-share">
          <p className="vd-share-label">分享这场投票</p>
          <ShareCard url={`/vote/${vote.id}`} />
        </div>
      )}

      {notice && <div className="vd-alert vd-alert--ok">{notice}</div>}
      {submitError && <div className="vd-alert vd-alert--error">{submitError}</div>}
      {downloadError && (
        <div className="vd-alert vd-alert--error">
          {downloadError}
          <button type="button" className="vd-inline-button" onClick={() => void downloadPdf()}>
            重试下载
          </button>
        </div>
      )}

      {vote.isCreator && isModeB && (
        <InvitePanel voteId={vote.id} phase={vote.phase} onChanged={load} />
      )}

      {vote.phase === "DRAFT" && (
        <div className="vd-box">
          <p className="vd-box-title">
            {vote.isCreator ? "配置受邀人后开始投票" : "等待发起人开始投票"}
          </p>
          <p className="muted">
            {vote.isCreator
              ? "邀请至少一位用户接受后，在上方「受邀人管理」中开始投票；时长从开始时刻计算。"
              : "开始后才能提交选票，时长从开始时刻计算。"}
          </p>
        </div>
      )}

      {vote.phase === "LIVE" && (
        <>
          {vote.canVote ? (
            <>
              <h2 className="vd-section-title">选择选项</h2>
              <div className="vd-options">
                {sortedOptions.map((option) => {
                  const active = selected.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className={`vd-option${active ? " vd-option--active" : ""}${
                        option.isAbstain ? " vd-option--abstain" : ""
                      }`}
                    >
                      <input
                        type={vote.allowMultiple ? "checkbox" : "radio"}
                        name="vd-option"
                        checked={active}
                        onChange={() => handleSelect(option)}
                      />
                      <span className="vd-option-text">{option.text}</span>
                      {option.isAbstain && (
                        <span className="vd-tag">系统选项</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <p className="vd-hint">
                {vote.allowMultiple
                  ? "可以选择多个选项；弃权与其它选项互斥，只能单独选择。"
                  : "只能选择 1 个选项；弃权为系统选项，计为一票。"}
              </p>
              <button
                type="button"
                className="vd-submit"
                disabled={selected.length === 0 || submitting}
                onClick={handleSubmit}
              >
                {submitting
                  ? "提交中…"
                  : "提交投票（提交后自动下载全量记录 PDF）"}
              </button>
            </>
          ) : vote.hasVoted ? (
            <div className="vd-box vd-box--ok">
              <p className="vd-box-title">✅ 你已投过本场的票</p>
              <p className="muted">
                投票记录不含实名。可在「我的投票」查看你的假名与序号。
              </p>
            </div>
          ) : vote.isCreator ? (
            <div className="vd-box">
              <p className="vd-box-title">投票进行中</p>
              <p className="muted">
                你是发起人，可在上方「受邀人管理」中查看名单、移除未投票的受邀人并提前结束投票。
              </p>
            </div>
          ) : unverified ? (
            <div className="vd-box vd-box--warn">
              <p className="vd-box-title">实名核验尚未通过</p>
              <p className="muted">
                只有实名核验通过后才能投票。
                <Link to={accountHref}>去完成核验</Link>
              </p>
            </div>
          ) : unacceptedInvite ? (
            <div className="vd-box vd-box--warn">
              <p className="vd-box-title">你尚未接受本场邀请</p>
              <p className="muted">
                <Link to="/my-invites">去「我的邀请」接受邀请</Link>
                后即可投票。
              </p>
            </div>
          ) : (
            <div className="vd-box">
              <p className="muted">当前无法投票。</p>
            </div>
          )}
        </>
      )}

      {vote.phase === "ENDED" && (
        <div className="vd-box vd-box--ok">
          <p className="vd-box-title">投票已结束</p>
          <p className="muted">
            {vote.hasVoted ? "你已参与本场投票。" : "你没有参与本场投票。"}
          </p>
          <button
            type="button"
            className="vd-inline-button"
            onClick={() => void downloadPdf()}
          >
            下载完整全量记录 PDF
          </button>
        </div>
      )}

      {vote.phase === "LIVE" && (vote.hasVoted || vote.isCreator) && (
        <div className="vd-download">
          <button
            type="button"
            className="vd-inline-button"
            onClick={() => void downloadPdf()}
          >
            下载全量记录 PDF
          </button>
        </div>
      )}

      {vote.phase !== "DRAFT" && (
        <ResultsPanel
          results={results}
          phase={vote.phase}
          votedCount={vote.votedCount}
          eligibleCount={vote.eligibleCount}
        />
      )}

      {/* 模式 B 的创建者已在 InvitePanel 里看到完整名单，避免重复展示。 */}
      {(isModeB ? !vote.isCreator : vote.phase === "ENDED") && (
        <RosterPanel
          roster={roster}
          votedCount={vote.votedCount}
          eligibleCount={vote.eligibleCount}
        />
      )}
    </div>
  );
}
