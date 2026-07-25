// 照抄 Toonflow-web 的 axios 拦截器约定（去掉了它的多语言/复杂网络错误提示，保留核心行为）：
// 自动带 token、响应直接解包成 {code, data, message}、401 时清 token 并跳登录页。
import axios from "axios";
import { MessagePlugin } from "tdesign-vue-next";
import router from "@/router";

const http = axios.create();

http.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = token;
  return config;
});

http.interceptors.response.use(
  (response) => response.data,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("token");
      router.push("/login");
      MessagePlugin.error("登录已过期，请重新登录");
    }
    return Promise.reject(err?.response?.data ?? err);
  },
);

export default http;
