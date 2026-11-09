import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { formatUtc } from "../format";
import { inviteStatusLabel, inviteStatusPillClass } from "../labels";
import type { VotePhase } from "../types";
import ShareCard from "./ShareCard";
import "./InvitePanel.css";

interface InviteListEntry {
  id: string;
  username: string | null;
  realName: string | null;
  status: string;
  acceptedAt: string | null;
  expiresAt: string | null;
  voted: boolean;
}

interface CreatedLink {
  id: string;
  token: string;
  url: string;
}

interface InviteResult {
  created: Array<{ id: string; username: string; status: string }>;
  notFound: string[];
  duplicates: string[];
}

interface InvitePanelProps {
  voteId: string;
  phase: VotePhase;
  onChanged?: () => void | Promise<void>;
}

function splitUsernames(raw: string): string[] {
  return raw
    .split(/[\s,，;；]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function inviteName(invite: InviteListEntry): string {
  if (invite.realName) return invite.realName;
  if (invite.username) return `@${invite.username}`;
  return "一人一链接";
}

export default function InvitePanel({
  voteId,
  phase,
  onChanged,
}: InvitePanelProps) {
  const [invites, setInvites] = useState<InviteListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [usernamesInput, setUsernamesInput] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [inviteError, setInviteError] = useState("");

  const [linkCount, setLinkCount] = useState("1");
  const [creatingLinks, setCreatingLinks] = useState(false);
  const [links, setLinks] = useState<CreatedLink[]>([]);
  const [linkError, setLinkError] = useState("");

  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [actionError, setActionError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isDraft = phase === "DRAFT";
  const isLive = phase === "LIVE";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api.get<{ invites: InviteListEntry[] }>(
        `/api/votes/${voteId}/invites`
      );
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    } catch (error) {
      setLoadError(
        error instanceof ApiError ? error.message : "受邀名单加载失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, [voteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeInvites = invites.filter((invite) => invite.status !== "REMOVED");
  const acceptedCount = activeInvites.filter(
    (invite) => invite.status === "ACCEPTED"
  ).length;

  const inviteUsernames = async () => {
    const usernames = splitUsernames(usernamesInput);
    if (usernames.length === 0) {
      setInviteError("请输入至少一个用户名。");
      return;
    }

    setInviting(true);
    setInviteError("");
    setInviteResult(null);
    try {
      const result = await api.post<InviteResult>(
        `/api/votes/${voteId}/invites/usernames`,
        { usernames }
      );
      setInviteResult(result);
      setUsernamesInput("");
      await load();
      await onChanged?.();
    } catch (error) {
      setInviteError(
        error instanceof ApiError ? error.message : "邀请失败，请稍后重试。"
      );
    } finally {
      setInviting(false);
    }
  };

  const createLinks = async () => {
    const count = Number(linkCount);
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      setLinkError("生成数量需为 1 到 200 之间的整数。");
      return;
    }

    setCreatingLinks(true);
    setLinkError("");
    try {
      const result = await api.post<{ links: CreatedLink[] }>(
        `/api/votes/${voteId}/invites/links`,
        { count }
      );
      setLinks((previous) => [...result.links, ...previous]);
      await load();
      await onChanged?.();
    } catch (error) {
      setLinkError(
        error instanceof ApiError ? error.message : "生成链接失败，请稍后重试。"
      );
    } finally {
      setCreatingLinks(false);
    }
  };

  const startVote = async () => {
    if (!window.confirm("开始后不能再新增受邀人，确定现在开始投票吗？")) {
      return;
    }

    setStarting(true);
    setActionError("");
    try {
      await api.post(`/api/votes/${voteId}/start`);
      await load();
      await onChanged?.();
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "开始投票失败，请稍后重试。"
      );
    } finally {
      setStarting(false);
    }
  };

  const endVote = async () => {
    if (!window.confirm("确定提前结束本场投票吗？结束后不能再提交选票。")) {
      return;
    }

    setEnding(true);
    setActionError("");
    try {
      await api.post(`/api/votes/${voteId}/end`);
      await load();
      await onChanged?.();
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "结束投票失败，请稍后重试。"
      );
    } finally {
      setEnding(false);
    }
  };

  const removeInvite = async (invite: InviteListEntry) => {
    if (!window.confirm(`确定移除「${inviteName(invite)}」的邀请吗？`)) {
      return;
    }

    setRemovingId(invite.id);
    setActionError("");
    try {
      await api.delete(`/api/votes/${voteId}/invites/${invite.id}`);
      await load();
      await onChanged?.();
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "移除失败，请稍后重试。"
      );
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="ip-panel" aria-labelledby="ip-title">
      <header className="ip-head">
        <h2 id="ip-title" className="ip-title">
          受邀人管理
        </h2>
        <span className="ip-counts">
          已接受 {acceptedCount} / {activeInvites.length}
        </span>
      </header>

      {loadError && (
        <div className="ip-alert ip-alert--error">
          {loadError}
          <button
            type="button"
            className="ip-inline-button"
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      )}

      {actionError && <div className="ip-alert ip-alert--error">{actionError}</div>}

      {isDraft && (
        <div className="ip-block">
          <h3 className="ip-block-title">按用户名邀请</h3>
          <p className="ip-hint">
            粘贴多个用户名，用逗号、空格或换行分隔。只有已注册且实名核验通过的用户可以接受。
          </p>
          <textarea
            className="ip-textarea"
            rows={3}
            value={usernamesInput}
            placeholder="例如：alice, bob, carol"
            onChange={(event) => setUsernamesInput(event.target.value)}
            disabled={inviting}
          />
          <div className="ip-actions">
            <button
              type="button"
              onClick={() => void inviteUsernames()}
              disabled={inviting}
            >
              {inviting ? "邀请中…" : "发送邀请"}
            </button>
          </div>
          {inviteError && <p className="ip-error">{inviteError}</p>}
          {inviteResult && (
            <div className="ip-result">
              <p>本次新增 {inviteResult.created.length} 个邀请。</p>
              {inviteResult.notFound.length > 0 && (
                <p className="ip-warn">
                  用户不存在：{inviteResult.notFound.join("、")}
                </p>
              )}
              {inviteResult.duplicates.length > 0 && (
                <p className="ip-warn">
                  已在名单中：{inviteResult.duplicates.join("、")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {isDraft && (
        <div className="ip-block">
          <h3 className="ip-block-title">生成一人一链接</h3>
          <p className="ip-hint">
            适合尚未注册的人：单次有效，7 天过期，可随时移除。链接只在生成后显示，请立即复制或保存二维码。
          </p>
          <div className="ip-inline-form">
            <label className="ip-inline-label">
              数量
              <input
                className="ip-number"
                type="number"
                min={1}
                max={200}
                value={linkCount}
                onChange={(event) => setLinkCount(event.target.value)}
                disabled={creatingLinks}
              />
            </label>
            <button
              type="button"
              onClick={() => void createLinks()}
              disabled={creatingLinks}
            >
              {creatingLinks ? "生成中…" : "生成链接"}
            </button>
          </div>
          {linkError && <p className="ip-error">{linkError}</p>}
          {links.length > 0 && (
            <div className="ip-link-list">
              {links.map((link) => (
                <div className="ip-link-item" key={link.id}>
                  <ShareCard url={link.url} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ip-block">
        <h3 className="ip-block-title">名单</h3>
        {loading ? (
          <p className="ip-hint">名单加载中…</p>
        ) : loadError ? (
          <p className="ip-hint">名单暂不可用。</p>
        ) : invites.length === 0 ? (
          <p className="ip-hint">还没有邀请任何人。</p>
        ) : (
          <ul className="ip-list">
            {invites.map((invite) => {
              const showVoted = phase !== "ENDED" && invite.username !== null;
              const cannotRemove =
                !isLive && !isDraft
                  ? true
                  : invite.status === "REMOVED" ||
                    (isLive && invite.voted);
              return (
                <li className="ip-item" key={invite.id}>
                  <div className="ip-item-main">
                    <span className="ip-item-name">{inviteName(invite)}</span>
                    {invite.username && invite.realName && (
                      <span className="ip-item-username">@{invite.username}</span>
                    )}
                    <span className={inviteStatusPillClass(invite.status)}>
                      {inviteStatusLabel(invite.status)}
                    </span>
                    {showVoted && (
                      <span
                        className={`ip-tag${
                          invite.voted ? " ip-tag--voted" : " ip-tag--pending"
                        }`}
                      >
                        {invite.voted ? "已投" : "未投"}
                      </span>
                    )}
                    {invite.expiresAt && !invite.acceptedAt && (
                      <span className="ip-item-expiry">
                        有效期至 {formatUtc(invite.expiresAt)}
                      </span>
                    )}
                  </div>
                  {invite.status !== "REMOVED" && (
                    <button
                      type="button"
                      className="ip-inline-button"
                      onClick={() => void removeInvite(invite)}
                      disabled={cannotRemove || removingId === invite.id}
                      title={
                        isLive && invite.voted
                          ? "该受邀人已投票，不能移除"
                          : phase === "ENDED"
                            ? "投票已结束，不能移除"
                            : undefined
                      }
                    >
                      {removingId === invite.id ? "移除中…" : "移除"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isDraft && (
        <div className="ip-footer">
          {acceptedCount === 0 && (
            <p className="ip-hint">至少需要一位已接受的受邀人才能开始投票。</p>
          )}
          <button
            type="button"
            className="ip-primary"
            onClick={() => void startVote()}
            disabled={starting || acceptedCount === 0}
          >
            {starting ? "开始中…" : `开始投票（已接受 ${acceptedCount} 人）`}
          </button>
        </div>
      )}

      {isLive && (
        <div className="ip-footer">
          <p className="ip-hint">
            投票进行中不能再新增受邀人；已投票的受邀人不能移除。
          </p>
          <button
            type="button"
            className="ip-danger"
            onClick={() => void endVote()}
            disabled={ending}
          >
            {ending ? "结束中…" : "提前结束投票"}
          </button>
        </div>
      )}
    </section>
  );
}
