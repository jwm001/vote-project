import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function CreateVote() {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    allowMultiple: false,
    startAt: "",
    endAt: "",
  });
  const [options, setOptions] = useState(["", ""]);
  const navigate = useNavigate();

  const addOption = () => {
    setOptions([...options, ""]);
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  };

  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    const newOptions = options.filter((_, i) => i !== index);
    setOptions(newOptions);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem("token");
    if (!token) {
      alert("请先登录");
      navigate("/login");
      return;
    }

    const filteredOptions = options.filter((o) => o.trim() !== "");
    if (filteredOptions.length < 2) {
      alert("至少需要2个选项");
      return;
    }

    try {
      const res = await fetch("/api/votes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...formData,
          options: filteredOptions,
        }),
      });
      if (res.ok) {
        alert("创建成功");
        navigate("/");
      } else {
        const data = await res.json();
        alert(data.error || "创建失败");
      }
    } catch (error) {
      alert("创建失败");
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "20px" }}>
      <h2>创建投票活动</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "10px" }}>
          <label>标题：</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            required
            style={{ width: "100%", padding: "5px" }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>描述：</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            style={{ width: "100%", padding: "5px", height: "60px" }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>
            <input
              type="checkbox"
              checked={formData.allowMultiple}
              onChange={(e) => setFormData({ ...formData, allowMultiple: e.target.checked })}
            />
            允许多选
          </label>
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>开始时间：</label>
          <input
            type="datetime-local"
            value={formData.startAt}
            onChange={(e) => setFormData({ ...formData, startAt: e.target.value })}
            required
            style={{ width: "100%", padding: "5px" }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>结束时间：</label>
          <input
            type="datetime-local"
            value={formData.endAt}
            onChange={(e) => setFormData({ ...formData, endAt: e.target.value })}
            required
            style={{ width: "100%", padding: "5px" }}
          />
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label>选项：</label>
          {options.map((option, index) => (
            <div key={index} style={{ display: "flex", marginBottom: "5px" }}>
              <input
                type="text"
                value={option}
                onChange={(e) => updateOption(index, e.target.value)}
                required
                style={{ flex: 1, padding: "5px" }}
              />
              <button type="button" onClick={() => removeOption(index)} disabled={options.length <= 2}>
                删除
              </button>
            </div>
          ))}
          <button type="button" onClick={addOption}>
            添加选项
          </button>
        </div>
        <button type="submit">创建</button>
      </form>
    </div>
  );
}
