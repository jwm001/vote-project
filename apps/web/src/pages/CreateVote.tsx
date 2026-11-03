import { useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import './CreateVote.css';

interface FormState {
  title: string;
  description: string;
  allowMultiple: boolean;
  startAt: string;
  endAt: string;
  options: string[];
}

type FieldKey = 'title' | 'startAt' | 'endAt' | 'options';

const pad = (value: number) => String(value).padStart(2, '0');

function toLocalInput(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createInitialForm(): FormState {
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    title: '',
    description: '',
    allowMultiple: false,
    startAt: toLocalInput(start),
    endAt: toLocalInput(end),
    options: ['', ''],
  };
}

function formatRange(startAt: string, endAt: string) {
  const parse = (value: string) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const format = (date: Date) =>
    date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const start = parse(startAt);
  const end = parse(endAt);
  if (start && end) return `${format(start)} — ${format(end)}`;
  if (start) return `${format(start)} 起`;
  if (end) return `截至 ${format(end)}`;
  return '尚未设置时间';
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
    if (!form.startAt) next.startAt = '请选择开始时间';
    if (!form.endAt) next.endAt = '请选择结束时间';
    if (form.startAt && form.endAt && new Date(form.endAt) <= new Date(form.startAt)) {
      next.endAt = '结束时间必须晚于开始时间';
    }
    if (filledOptions.length < 2) {
      next.options = '至少需要填写 2 个选项';
    } else if (new Set(filledOptions).size !== filledOptions.length) {
      next.options = '选项内容不能重复';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setServerError('');
    if (submitting) return;

    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    if (!validate()) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          allowMultiple: form.allowMultiple,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          options: filledOptions,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        navigate(`/vote/${data.vote.id}`);
        return;
      }
      setServerError(data.error || '创建失败，请稍后重试');
    } catch {
      setServerError('网络异常，创建失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cv-card">
      <header className="cv-head">
        <div className="cv-head-icon">📝</div>
        <h1 className="cv-title">创建新投票</h1>
        <p className="cv-sub">填写投票信息，创建后生成匿名投票入口</p>
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
              <h2 className="cv-section-title">投票时间</h2>
            </div>

            <div className="cv-dates">
              <div className="cv-field">
                <label className="cv-label" htmlFor="cv-start">
                  开始时间 <span className="cv-req">*</span>
                </label>
                <input
                  id="cv-start"
                  type="datetime-local"
                  value={form.startAt}
                  aria-required="true"
                  aria-invalid={Boolean(errors.startAt)}
                  onChange={event => {
                    update('startAt', event.target.value);
                    clearError('startAt');
                    clearError('endAt');
                  }}
                />
                {errors.startAt && (
                  <div className="cv-field-foot">
                    <span className="cv-error" role="alert">
                      {errors.startAt}
                    </span>
                  </div>
                )}
              </div>

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
              </div>
            </div>
            <p className="cv-hint">按你所在时区填写，系统统一以 UTC 存储。</p>
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
              {form.allowMultiple ? '投票者可以选择多个选项' : '每位投票者只能选择 1 个选项'}
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
              <p className="cv-hint">至少 2 个；按此顺序展示；悬停可调整顺序或删除，回车可继续添加</p>
            )}
          </section>

          {serverError && (
            <div className="cv-alert" role="alert">
              {serverError}
            </div>
          )}

          <div className="cv-actions">
            <button type="button" className="cv-btn-ghost" onClick={() => navigate('/votes')}>
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
            {form.description.trim() && <p className="cv-preview-desc">{form.description.trim()}</p>}
            <div className="cv-preview-meta">
              <span className="cv-pill">{form.allowMultiple ? '多选' : '单选'}</span>
              <span>🕐 {formatRange(form.startAt, form.endAt)}</span>
            </div>
            <div className="cv-preview-label">投票选项</div>
            <div className="cv-preview-options">
              {previewOptions.map((option, index) => (
                <div className="cv-preview-option" key={index}>
                  <span>{form.allowMultiple ? '⬜' : '⚪'}</span>
                  {option}
                </div>
              ))}
            </div>
            <div className="cv-preview-submit">提交投票</div>
          </div>
          <ul className="cv-tips">
            <li>投票开始后参与者才能投票</li>
            <li>每场投票每人只能参与一次</li>
            <li>投票成功后必须下载全量记录 PDF</li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
