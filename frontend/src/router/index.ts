import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/episodes" },
    { path: "/login", name: "login", component: () => import("@/views/LoginView.vue"), meta: { public: true } },
    { path: "/episodes", name: "episodes", component: () => import("@/views/EpisodeListView.vue") },
    { path: "/ads", name: "ads", component: () => import("@/views/AdListView.vue") },
    { path: "/monitor", name: "monitor", component: () => import("@/views/MonitorView.vue") },
    { path: "/episodes/:id", name: "session", component: () => import("@/views/SessionView.vue"), props: true },
  ],
});

router.beforeEach((to) => {
  const hasToken = !!localStorage.getItem("token");
  if (!to.meta.public && !hasToken) return { name: "login", query: { redirect: to.fullPath } };
  if (to.name === "login" && hasToken) return { name: "episodes" };
  return true;
});

export default router;
