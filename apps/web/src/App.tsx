import { BrowserRouter, Routes, Route } from "react-router-dom";
import Register from "./pages/Register";
import Login from "./pages/Login";
import AdminReview from "./pages/AdminReview";

function Home() {
  return (
    <div>
      <h1>投票系统 - 首页</h1>
      <a href="/register">注册</a> | <a href="/login">登录</a> | <a href="/admin/review">管理员审核</a>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/admin/review" element={<AdminReview />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

