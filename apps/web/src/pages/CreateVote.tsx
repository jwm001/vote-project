import { useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import './CreateVote.css';

type ParticipationMode = 'OPEN_LINK' | 'INVITE_ONLY';
type DurationUnit = 'hours' | 'days';

interface FormState {
  title: string;
  description: string;
  allowMultiple: boolean;
  participationMode: ParticipationMode;
  resultsPublicDuringVote: boolean;
  endAt: string;
  durationValue: number;
  durationUnit: DurationUnit;
  options: string[];
}

type FieldKey = 'title' | 'endAt' | 'duration' | 'options';

const ABSTAIN_TEXT = '弃权';
// 与后端 vote.constants.ts 的 MAX_DURATION_MINUTES 保持一致。
const MAX_DURATION_MINUTES = 43_200;

const pad = (value: number) => String(value).padStart(2, '0');

function toLocalInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createInitialForm(): FormState {
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: '',
    description: '',
    allowMultiple: false,
    participationMode: 'OPEN_LINK',
    resultsPublicDuringVote: false,
    endAt: toLocalInput(end),
    durationValue: 7,
    durationUnit: 'days',
    options: ['', ''],
  };
}

function formatEndAt(value: string) {
  if (!value) return '尚未设置结束时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未设置结束时间';
  return `截至 ${date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatDuration(value: number, unit: DurationUnit) {
  if (!value || value <= 0) return '尚未设置时长';
  return `时长 ${value} ${unit === 'hours' ? '小时' : '天'}`;
}

function durationToMinutes(value: number, unit: DurationUnit) {
  const minutes = value * (unit === 'hours' ? 60 : 1440);
  // 1.1 天这类输入会得到 1584.0000000000002，浮点误差不该算成「非整数分钟」。
  return Math.abs(minutes - Math.round(minutes)) < 1e-6
    ? Math.round(minutes)
    : minutes;
}

export default function CreateVote() {
  const [form, setForm] = useState<FormState>(createInitialForm);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const navigate = useNavigate();

  const filledOptions = useMemo(
    () => form.options.map(option => option.trim()).filter(Boolean),
    [form.options]
  );
  const previewOptions = filledOptions.length > 0 ? filledOptions : ['选项 1', '选项 2'];

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const clearError = (key: FieldKey) => {
    setErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setOption = (index: number, value: string) => {
    setForm(prev => {
      const options = [...prev.options];
      options[index] = value;
      return { ...prev, options };
    });
    clearError('options');
  };

  const addOption = () => {
    setForm(prev => ({ ...prev, options: [...prev.options, ''] }));
    clearError('options');
  };

  const removeOption = (index: number) => {
    setForm(prev =>
      prev.options.length > 2
        ? { ...prev, options: prev.options.filter((_, i) => i !== index) }
        : prev
    );
    clearError('options');
  };

  const moveOption = (index: number, direction: -1 | 1) => {
    setForm(prev => {
      const target = index + direction;
      if (target < 0 || target >= prev.options.length) return prev;
      const options = [...prev.options];
      [options[index], options[target]] = [options[target], options[index]];
      return { ...prev, options };
    });
    clearError('options');
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (index === form.options.length - 1) {
      addOption();
      requestAnimationFrame(() => document.getElementById(`cv-option-${index + 1}`)?.focus());
    } else {
      document.getElementById(`cv-option-${index + 1}`)?.focus();
    }
  };

  const validate = () => {
    const next: Partial<Record<FieldKey, string>> = {};
    if (!form.title.trim()) next.title = '请填写投票标题';

    if (form.participationMode === 'OPEN_LINK') {
      if (!form.endAt) {
        next.endAt = '请选择结束时间';
      } else {
        const endTime = new Date(form.endAt).getTime();
        if (Number.isNaN(endTime) || endTime <= Date.now()) {
          next.endAt = '结束时间必须晚于现在';
        }
      }
    } else {
      const minutes = durationToMinutes(form.durationValue, form.durationUnit);
      if (!form.durationValue || form.durationValue <= 0) {
        next.duration = '请填写投票时长';
      } else if (!Number.isInteger(minutes)) {
        next.duration = '时长必须能换算成整数分钟';
      } else if (minutes > MAX_DURATION_MINUTES) {
        next.duration = '时长不能超过 30 天（720 小时）';
      }
    }

    if (filledOptions.length < 2) {
      next.options = '至少需要填写 2 个选项';
    } else if (new Set(filledOptions).size !== filledOptions.length) {
      next.options = '选项内容不能重复';
    } else if (filledOptions.includes(ABSTAIN_TEXT)) {
      next.options = `选项不能命名为「${ABSTAIN_TEXT}」，系统会自动添加`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setServerError('');
    if (submitting) return;

    if (!localStorage.getItem('token')) {
      navigate('/login?redirect=/create');
      return;
    }
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        allowMultiple: form.allowMultiple,
        participationMode: form.participationMode,
        resultsPublicDuringVote: form.resultsPublicDuringVote,
        options: filledOptions,
      };
      if (form.participationMode === 'OPEN_LINK') {
        payload.endAt = new Date(form.endAt).toISOString();
      } else {
        payload.durationMinutes = durationToMinutes(
          form.durationValue,
          form.durationUnit
        );
      }

      const data = await api.post<{ vote: { id: string } }>('/api/votes', payload);
      navigate(`/vote/${data.vote.id}`);
    } catch (error) {
      setServerError(
        error instanceof ApiError ? error.message : '创建失败，请稍后重试'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cv-card">
      <header className="cv-head">
        <div className="cv-head-icon">📝</div>
        <h1 className="cv-title">创建新投票</h1>
        <p className="cv-sub">选择参与方式，创建后生成匿名投票入口</p>
      </header>

      <div className="cv-layout">
        <form className="cv-form" onSubmit={handleSubmit} noValidate>
          <section className="cv-section">
            <div className="cv-section-head">
              <span className="cv-step">1</span>
              <h2 className="cv-section-title">基本信息</h2>
            </div>

            <div className="cv-field">
              <label className="cv-label" htmlFor="cv-title">
                投票标题 <span className="cv-req">*</span>
              </label>
              <input
                id="cv-title"
                value={form.title}
                maxLength={80}
                placeholder="例如：2026 年度最佳项目评选"
                autoFocus
                aria-required="true"
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'cv-title-error' : undefined}
                onChange={event => {
                  update('title', event.target.value);
                  clearError('title');
                }}
              />
              <div className="cv-field-foot">
                {errors.title ? (
                  <span id="cv-title-error" className="cv-error" role="alert">
                    {errors.title}
                  </span>
                ) : (
                  <span />
                )}
                <span className="cv-counter">{form.title.length}/80</span>
              </div>
            </div>

            <div className="cv-field">
              <label className="cv-label" htmlFor="cv-description">
                投票描述 <span className="cv-optional">可选</span>
              </label>
              <textarea
                id="cv-description"
                rows={3}
                maxLength={300}
                placeholder="说明投票目的、规则或注意事项"
                value={form.description}
                onChange={event => update('description', event.target.value)}
              />
              <div className="cv-field-foot">
                <span className="cv-hint">会显示在投票页标题下方</span>
                <span className="cv-counter">{form.description.length}/300</span>
              </div>
            </div>
          </section>

          <section className="cv-section">
            <div className="cv-section-head">
              <span className="cv-step">2</span>
              <h2 className="cv-section-title">参与方式</h2>
            </div>

            <div className="cv-segmented" role="group" aria-label="参与方式">
              <button
                type="button"
                className={
                  form.participationMode === 'OPEN_LINK'
                    ? 'cv-seg cv-seg--active'
                    : 'cv-seg'
                }
                aria-pressed={form.participationMode === 'OPEN_LINK'}
                onClick={() => update('participationMode', 'OPEN_LINK')}
              >
                公开链接
              </button>
              <button
                type="button"
                className={
                  form.participationMode === 'INVITE_ONLY'
                    ? 'cv-seg cv-seg--active'
                    : 'cv-seg'
                }
                aria-pressed={form.participationMode === 'INVITE_ONLY'}
                onClick={() => update('participationMode', 'INVITE_ONLY')}
              >
                邀请制
              </button>
            </div>
            <p className="cv-hint">
              {form.participationMode === 'OPEN_LINK'
                ? '创建后立即开始，任何登录用户打开链接都能投票。'
                : '创建后先邀请参与者，再手动开始；只有受邀者能投票。'}
            </p>

            {form.participationMode === 'OPEN_LINK' ? (
              <div className="cv-field">
                <label className="cv-label" htmlFor="cv-end">
                  结束时间 <span className="cv-req">*</span>
                </label>
                <input
                  id="cv-end"
                  type="datetime-local"
                  value={form.endAt}
                  aria-required="true"
                  aria-invalid={Boolean(errors.endAt)}
                  onChange={event => {
                    update('endAt', event.target.value);
                    clearError('endAt');
                  }}
                />
                {errors.endAt && (
                  <div className="cv-field-foot">
                    <span className="cv-error" role="alert">
                      {errors.endAt}
                    </span>
                  </div>
                )}
                <p className="cv-hint">
                  创建即开始；按你所在时区填写，系统统一以 UTC 存储。创建者可提前结束。
                </p>
              </div>
            ) : (
              <div className="cv-field">
                <label className="cv-label" htmlFor="cv-duration">
                  投票时长 <span className="cv-req">*</span>
                </label>
                <div className="cv-duration">
                  <input
                    id="cv-duration"
                    type="number"
                    min={1}
                    step={1}
                    value={form.durationValue === 0 ? '' : form.durationValue}
                    aria-required="true"
                    aria-invalid={Boolean(errors.duration)}
                    onChange={event => {
                      update(
                        'durationValue',
                        event.target.value === '' ? 0 : Number(event.target.value)
                      );
                      clearError('duration');
                    }}
                  />
                  <select
                    aria-label="时长单位"
                    value={form.durationUnit}
                    onChange={event =>
                      update('durationUnit', event.target.value as DurationUnit)
                    }
                  >
                    <option value="hours">小时</option>
                    <option value="days">天</option>
                  </select>
                </div>
                {errors.duration && (
                  <div className="cv-field-foot">
                    <span className="cv-error" role="alert">
                      {errors.duration}
                    </span>
                  </div>
                )}
                <p className="cv-hint">
                  时长从你手动开始投票时计算，最长 30 天。
                </p>
              </div>
            )}

            <label className="cv-toggle">
              <input
                type="checkbox"
                checked={form.resultsPublicDuringVote}
                onChange={event =>
                  update('resultsPublicDuringVote', event.target.checked)
                }
              />
              <span>
                <strong>实时公开结果</strong>
                <span className="cv-toggle-note">
                  默认关闭；进行中只显示已投人数。开始后不可更改。
                </span>
              </span>
            </label>
          </section>

          <section className="cv-section">
            <div className="cv-section-head">
              <span className="cv-step">3</span>
              <h2 className="cv-section-title">投票方式</h2>
            </div>

            <div className="cv-segmented" role="group" aria-label="投票方式">
              <button
                type="button"
                className={form.allowMultiple ? 'cv-seg' : 'cv-seg cv-seg--active'}
                aria-pressed={!form.allowMultiple}
                onClick={() => update('allowMultiple', false)}
              >
                单选
              </button>
              <button
                type="button"
                className={form.allowMultiple ? 'cv-seg cv-seg--active' : 'cv-seg'}
                aria-pressed={form.allowMultiple}
                onClick={() => update('allowMultiple', true)}
              >
                多选
              </button>
            </div>
            <p className="cv-hint">
              {form.allowMultiple
                ? '投票者可以选择多个选项'
                : '每位投票者只能选择 1 个选项'}
            </p>
          </section>

          <section className="cv-section">
            <div className="cv-section-head">
              <span className="cv-step">4</span>
              <h2 className="cv-section-title">投票选项</h2>
              <span className="cv-count">{filledOptions.length} 个</span>
            </div>

            <div className="cv-options">
              {form.options.map((option, index) => (
                <div className="cv-option-row" key={index}>
                  <span className="cv-option-num">{index + 1}</span>
                  <input
                    id={`cv-option-${index}`}
                    className="cv-option-input"
                    value={option}
                    maxLength={80}
                    placeholder={`选项 ${index + 1}`}
                    aria-label={`选项 ${index + 1}`}
                    onChange={event => setOption(index, event.target.value)}
                    onKeyDown={event => handleOptionKeyDown(event, index)}
                  />
                  <div className="cv-option-tools">
                    <button
                      type="button"
                      className="cv-icon-btn"
                      aria-label={`上移选项 ${index + 1}`}
                      title="上移"
                      disabled={index === 0}
                      onClick={() => moveOption(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="cv-icon-btn"
                      aria-label={`下移选项 ${index + 1}`}
                      title="下移"
                      disabled={index === form.options.length - 1}
                      onClick={() => moveOption(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="cv-icon-btn cv-icon-btn--danger"
                      aria-label={`删除选项 ${index + 1}`}
                      title="删除"
                      disabled={form.options.length <= 2}
                      onClick={() => removeOption(index)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              <div className="cv-option-row cv-option-row--locked">
                <span className="cv-option-num cv-option-num--muted">
                  {form.options.length + 1}
                </span>
                <input
                  className="cv-option-input"
                  value={ABSTAIN_TEXT}
                  readOnly
                  aria-label={`${ABSTAIN_TEXT}（系统自动添加）`}
                />
                <span className="cv-lock-badge">系统自动添加</span>
              </div>
            </div>

            <button type="button" className="cv-add" onClick={addOption}>
              + 添加选项
            </button>

            {errors.options ? (
              <div className="cv-field-foot">
                <span className="cv-error" role="alert">
                  {errors.options}
                </span>
              </div>
            ) : (
              <p className="cv-hint">
                至少 2 个；按此顺序展示；悬停可调整顺序或删除，回车可继续添加。弃权固定排在最后，并计入票数。
              </p>
            )}
          </section>

          {serverError && (
            <div className="cv-alert" role="alert">
              {serverError}
            </div>
          )}

          <div className="cv-actions">
            <button type="button" className="cv-btn-ghost" onClick={() => navigate('/')}>
              取消
            </button>
            <button type="submit" className="cv-btn-primary" disabled={submitting}>
              {submitting ? '创建中…' : '创建投票'}
            </button>
          </div>
        </form>

        <aside className="cv-preview" aria-label="投票页预览">
          <div className="cv-preview-head">
            <span className="cv-preview-dot" />
            投票者看到的效果
          </div>
          <div className="cv-preview-card">
            <h3 className="cv-preview-title">{form.title.trim() || '未命名投票'}</h3>
            {form.description.trim() && (
              <p className="cv-preview-desc">{form.description.trim()}</p>
            )}
            <div className="cv-preview-meta">
              <span className="cv-pill">
                {form.participationMode === 'OPEN_LINK' ? '公开链接' : '邀请制'}
              </span>
              <span className="cv-pill">{form.allowMultiple ? '多选' : '单选'}</span>
              <span>
                🕐{' '}
                {form.participationMode === 'OPEN_LINK'
                  ? formatEndAt(form.endAt)
                  : formatDuration(form.durationValue, form.durationUnit)}
              </span>
            </div>
            <div className="cv-preview-label">投票选项</div>
            <div className="cv-preview-options">
              {previewOptions.map((option, index) => (
                <div className="cv-preview-option" key={index}>
                  <span>{form.allowMultiple ? '⬜' : '⚪'}</span>
                  {option}
                </div>
              ))}
              <div className="cv-preview-option cv-preview-option--locked">
                <span>{form.allowMultiple ? '⬜' : '⚪'}</span>
                {ABSTAIN_TEXT}
              </div>
            </div>
            <div className="cv-preview-submit">提交投票</div>
          </div>
          <ul className="cv-tips">
            <li>
              {form.participationMode === 'OPEN_LINK'
                ? '创建后立即开始，可提前结束'
                : '邀请足够的人后再手动开始'}
            </li>
            <li>每场投票每人只能参与一次</li>
            <li>投票成功后必须下载全量记录 PDF</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
