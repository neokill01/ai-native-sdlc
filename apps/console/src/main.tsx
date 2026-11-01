import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileCheck2,
  FileText,
  FolderGit2,
  GitBranch,
  Layers3,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  X,
} from "lucide-react";
import "./style.css";

type Project = { id: string; name: string; repository: string; stack: string };
type Task = {
  id: string;
  goal: string;
  status: string;
  version: number;
  projectId: string;
  createdAt: string;
  active: boolean;
  repairs: number;
  verification: string;
  artifacts: Record<string, { content: string; hash: string }>;
  stopReason?: string;
  checkpoint?: { operation?: string };
  deliverySummary?: string;
};
type Event = { sequence: number; type: string; payload: Record<string, any> };
type Report = {
  id: string;
  status: string;
  verification: string;
  attempt: number;
  acceptance: string;
  checks: { check: string; verdict: string }[];
  tools: {
    attempt: number;
    record: {
      tool: string;
      command?: string;
      exitCode?: number;
      path?: string;
      hash?: string;
    };
  }[];
  deliverySummary: string | null;
};
let sessionToken = "";
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Devos-Token": sessionToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
const statuses: Record<string, string> = {
  created: "待准备",
  intent_review: "待需求审批",
  spec_review: "待规格审批",
  plan_review: "待计划审批",
  queued: "待执行",
  running: "执行中",
  verifying: "验证中",
  repairing: "修复中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  paused: "待恢复核对",
};
const reviewKinds: Record<string, string> = {
  intent_review: "intent",
  spec_review: "spec",
  plan_review: "plan",
};
const kinds: Record<string, string> = {
  intent: "需求目标",
  spec: "验收规格",
  plan: "执行计划",
};
const runningStates = ["running", "verifying", "repairing"];
const reviewing = (t: Task) => Boolean(reviewKinds[t.status]);
const stamp = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
function Badge({ task }: { task: Task }) {
  return (
    <span
      className={`badge ${task.status === "completed" ? "green" : reviewing(task) ? "amber" : task.status === "failed" ? "red" : runningStates.includes(task.status) ? "blue" : "gray"}`}
    >
      {task.active ? (
        <LoaderCircle size={12} className="spin" />
      ) : task.status === "completed" ? (
        <CheckCircle2 size={12} />
      ) : (
        <Circle size={10} />
      )}{" "}
      {statuses[task.status] || task.status}
    </span>
  );
}
function Modal({
  children,
  onClose,
  drawer = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "drawer" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div>{children}</div>
    </dialog>
  );
}
function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  const [page, setPage] = useState("overview"),
    [project, setProject] = useState("all"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    try {
      const rows = await api("/tasks");
      setTasks(rows);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      throw e;
    }
  };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setInterval>;
    (async () => {
      try {
        const s = await fetch("/api/session").then((r) => r.json());
        if (!live) return;
        sessionToken = s.token;
        setProjects(s.projects);
        await refresh();
        if (live)
          timer = setInterval(
            () => refresh().catch((e) => setError(e.message)),
            1500,
          );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function action(id: string, name: string, extra: object = {}) {
    const t = tasks.find((t) => t.id === id);
    if (!t) return;
    setBusy(true);
    setError("");
    try {
      await api(`/tasks/${id}/${name}`, { version: t.version, ...extra });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function create(title: string, description: string, projectId: string) {
    setBusy(true);
    setError("");
    try {
      const t = await api("/tasks", { title, description, projectId });
      await refresh();
      setCreating(false);
      setSelected(t.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const scoped = tasks.filter(
    (t) => project === "all" || t.projectId === project,
  );
  const filtered = scoped.filter(
    (t) =>
      (filter === "all" ||
        (filter === "review" && reviewing(t)) ||
        (filter === "active" && runningStates.includes(t.status)) ||
        filter === t.status) &&
      t.goal.toLowerCase().includes(query.toLowerCase()),
  );
  const pending = scoped.filter(reviewing).length,
    active = scoped.filter((t) => t.active).length,
    complete = scoped.filter((t) => t.status === "completed").length;
  const task = tasks.find((t) => t.id === selected);
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={() => {
            setPage("overview");
            setProject("all");
          }}
        >
          <div className="brand-icon">
            <Layers3 size={22} />
          </div>
          <span>
            Agentic <b>DevOS</b>
            <small>ENGINEERING WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="avatar">N</span>
          <span>
            Neo 的工作空间<small>个人工作空间</small>
          </span>
          <MoreHorizontal size={17} />
        </div>
        <span className="nav-caption">工作空间</span>
        <nav aria-label="主导航">
          <button
            className={page === "overview" ? "nav active" : "nav"}
            onClick={() => setPage("overview")}
          >
            <LayoutDashboard size={18} />
            工作概览
          </button>
          <button
            className={page === "tasks" ? "nav active" : "nav"}
            onClick={() => setPage("tasks")}
          >
            <ListTodo size={18} />
            任务中心<span className="nav-count">{tasks.length}</span>
          </button>
          <button
            className={page === "reports" ? "nav active" : "nav"}
            onClick={() => setPage("reports")}
          >
            <FileCheck2 size={18} />
            交付报告
          </button>
          <button
            className={page === "projects" ? "nav active" : "nav"}
            onClick={() => setPage("projects")}
          >
            <FolderGit2 size={18} />
            项目仓库
          </button>
        </nav>
        <div className="nav-caption project-caption">
          项目 <span>{projects.length}</span>
        </div>
        <button
          className={`project-nav ${project === "all" ? "selected" : ""}`}
          onClick={() => {
            setProject("all");
            setPage("tasks");
          }}
        >
          <span className="project-dot all" />
          全部项目
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            className={`project-nav ${project === p.id ? "selected" : ""}`}
            onClick={() => {
              setProject(p.id);
              setPage("tasks");
            }}
          >
            <span className={`project-dot ${p.id}`} />
            {p.name}
          </button>
        ))}
        <div className="sidebar-bottom">
          <span
            className={connected ? "online-dot" : "online-dot disconnected"}
          />
          {connected ? "本地执行服务已连接" : "执行服务未连接"}
          <small>Mock 模式 · 无模型调用</small>
          <div className="profile">
            <span className="avatar">N</span>
            <span>
              Neo<small>本机操作者</small>
            </span>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <span>
            工作空间 <ChevronRight size={14} />{" "}
            {page === "overview"
              ? "工作概览"
              : page === "tasks"
                ? "任务中心"
                : page === "reports"
                  ? "交付报告"
                  : "项目仓库"}
          </span>
          <span className="top-status">
            <span className="online-dot" />
            Mock 已启用 <span className="top-divider" />{" "}
            <span className="avatar small">N</span>
          </span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR ENGINEERING, IN ONE PLACE</div>
              <h1>
                {page === "overview"
                  ? "让每项开发任务，有迹可循。"
                  : page === "tasks"
                    ? "任务中心"
                    : page === "reports"
                      ? "交付报告"
                      : "项目仓库"}
              </h1>
              <p>
                {page === "overview"
                  ? "从需求到交付，掌握任务进度与每一次关键决策。"
                  : page === "tasks"
                    ? "管理需求、审批与执行，在可验证的流程中推进交付。"
                    : page === "reports"
                      ? "查看真实测试证据，区分执行完成与需求验收。"
                      : "项目关联与执行模式，一处查看。"}
              </p>
            </div>
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={17} />
              新建任务
            </button>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button aria-label="关闭提示" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          <section className="mock-banner">
            <div className="banner-icon">
              <Terminal size={20} />
            </div>
            <div>
              <strong>先跑通流程，再连接智能。</strong>
              <p>
                当前为 Mock
                演练：仅执行独立样例与真实断言，不修改所选项目仓库，不消耗模型额度。
              </p>
            </div>
            <span className="mode-tag">MOCK MODE</span>
          </section>
          {page === "projects" ? (
            <section className="project-grid">
              {projects.map((p) => (
                <article className="project-card" key={p.id}>
                  <div className="project-icon">
                    <FolderGit2 size={24} />
                  </div>
                  <h2>{p.name}</h2>
                  <p>{p.repository}</p>
                  <div className="repo-stack">{p.stack}</div>
                  <footer>
                    <span>
                      {tasks.filter((t) => t.projectId === p.id).length}{" "}
                      项关联任务
                    </span>
                    <button
                      className="text-button"
                      onClick={() => {
                        setProject(p.id);
                        setPage("tasks");
                      }}
                    >
                      查看任务 <ArrowRight size={14} />
                    </button>
                  </footer>
                </article>
              ))}
            </section>
          ) : (
            <>
              <section className="stats" aria-label="任务统计">
                {[
                  {
                    label: "全部任务",
                    value: scoped.length,
                    icon: ListTodo,
                    note: "本地持久化记录",
                    color: "blue",
                  },
                  {
                    label: "待审批",
                    value: pending,
                    icon: FileText,
                    note: "由你确认下一步",
                    color: "amber",
                  },
                  {
                    label: "正在执行",
                    value: active,
                    icon: Activity,
                    note: "后台独立推进",
                    color: "purple",
                  },
                  {
                    label: "已完成",
                    value: complete,
                    icon: CheckCircle2,
                    note: "仍需人工需求验收",
                    color: "green",
                  },
                ].map((s) => (
                  <article className="stat" key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <s.icon size={18} className={s.color} />
                    </div>
                    <strong>{s.value.toString().padStart(2, "0")}</strong>
                    <small>{s.note}</small>
                  </article>
                ))}
              </section>
              <section className="task-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {page === "reports"
                        ? "任务报告"
                        : page === "overview"
                          ? "任务动态"
                          : "全部任务"}{" "}
                      <span>{scoped.length}</span>
                    </h2>
                    <p>
                      {page === "overview"
                        ? "下一步清晰可见，每个结果都有依据。"
                        : "选择任务查看产物、执行事件与报告。"}
                    </p>
                  </div>
                  <span className="subtle">
                    <Clock3 size={13} />
                    自动刷新
                  </span>
                </div>
                <div className="table-toolbar">
                  <div
                    className="filter-tabs"
                    role="group"
                    aria-label="状态筛选"
                  >
                    {[
                      ["all", "全部"],
                      ["review", "待审批"],
                      ["active", "执行中"],
                      ["completed", "已完成"],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        className={filter === v ? "chosen" : ""}
                        onClick={() => setFilter(v)}
                      >
                        {l}
                        {v === "review" && pending > 0 && (
                          <span>{pending}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={15} />
                    <input
                      aria-label="搜索任务"
                      placeholder="搜索任务名称…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                {loading ? (
                  <div className="empty">
                    <LoaderCircle className="spin" />
                    <h3>正在连接工作空间</h3>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon">
                      <GitBranch size={28} />
                    </div>
                    <h3>
                      {tasks.length
                        ? "没有符合条件的任务"
                        : "从一项可验证的任务开始"}
                    </h3>
                    <p>
                      {tasks.length
                        ? "试试调整筛选或搜索条件。"
                        : "创建需求，逐步确认规格与计划，再观察一次完整的执行和修复。"}
                    </p>
                    {!tasks.length && (
                      <button
                        className="secondary"
                        disabled={busy || !projects.length}
                        onClick={() =>
                          create(
                            "智创码坊 · 首次流程演练",
                            "演练需求审批、计划确认、测试失败后的有限修复，以及报告查询。",
                            "zhichuang",
                          )
                        }
                      >
                        <Play size={15} />
                        创建示例任务
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>任务 / 项目</th>
                          <th>状态</th>
                          <th>执行模式</th>
                          <th>创建时间</th>
                          <th>下一步</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <button
                                className="task-name"
                                onClick={() => setSelected(t.id)}
                              >
                                <span
                                  className={`task-symbol ${t.status === "completed" ? "done" : ""}`}
                                >
                                  {t.status === "completed" ? (
                                    <Check size={15} />
                                  ) : (
                                    <GitBranch size={15} />
                                  )}
                                </span>
                                <span>
                                  {t.goal}
                                  <small>
                                    {
                                      projects.find((p) => p.id === t.projectId)
                                        ?.name
                                    }{" "}
                                    <span>· {t.id.slice(0, 8)}</span>
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td>
                              <Badge task={t} />
                            </td>
                            <td>
                              <span className="mono muted">MOCK</span>
                            </td>
                            <td className="muted date">{stamp(t.createdAt)}</td>
                            <td>
                              <button
                                className="row-action"
                                onClick={() => setSelected(t.id)}
                              >
                                {reviewing(t)
                                  ? "查看并审批"
                                  : t.status === "queued"
                                    ? "查看并执行"
                                    : page === "reports" ||
                                        t.status === "completed"
                                      ? "查看报告"
                                      : "查看详情"}
                                <ChevronRight size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="table-footer">
                  <span>共 {filtered.length} 项任务</span>
                  <span>
                    <ShieldCheck size={13} />
                    审批、执行与验证均保留事件记录
                  </span>
                </div>
              </section>
              {page === "overview" && (
                <section className="flow-card">
                  <div>
                    <h2>一个目标，一条清晰的交付路径</h2>
                    <p>关键阶段由人确认，执行结果由证据说明。</p>
                  </div>
                  <div className="flow-steps">
                    {[
                      "需求目标",
                      "规格审批",
                      "计划确认",
                      "执行与修复",
                      "交付报告",
                    ].map((s, i) => (
                      <React.Fragment key={s}>
                        <span>
                          <b>{i + 1}</b>
                          {s}
                        </span>
                        {i < 4 && <ChevronRight size={15} />}
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              Agentic DevOS <span> / </span> 单 Agent 工程工作台
            </span>
            <span>本地单用户预览 · React + Vite</span>
          </footer>
        </main>
      </div>
      {creating && (
        <CreateTask
          projects={projects}
          initialProject={project}
          busy={busy}
          onClose={() => setCreating(false)}
          onSubmit={create}
        />
      )}
      {task && (
        <TaskDetail
          task={task}
          project={projects.find((p) => p.id === task.projectId)}
          initialTab={page === "reports" ? "report" : "overview"}
          busy={busy}
          onClose={() => setSelected(null)}
          onAction={(name, extra) => action(task.id, name, extra)}
        />
      )}
    </div>
  );
}
function CreateTask({
  projects,
  initialProject,
  busy,
  onClose,
  onSubmit,
}: {
  projects: Project[];
  initialProject: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (title: string, desc: string, project: string) => void;
}) {
  const [title, setTitle] = useState(""),
    [desc, setDesc] = useState(""),
    [project, setProject] = useState(
      initialProject === "all" ? projects[0]?.id || "" : initialProject,
    );
  return (
    <Modal onClose={onClose}>
      <div className="modal-heading">
        <div className="modal-icon">
          <Plus size={20} />
        </div>
        <button className="icon-button" aria-label="关闭" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <h2>创建开发任务</h2>
      <p className="muted">先描述目标，下一步确认需求与验收规格。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(title, desc, project);
        }}
      >
        <label>
          关联项目
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          任务名称
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="例如：优化移动端导航体验"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          需求描述
          <textarea
            rows={5}
            maxLength={8000}
            placeholder="希望解决什么问题？预期行为和验收标准是什么？"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </label>
        <div className="form-note">
          <ShieldCheck size={15} />
          Mock 仅演练流程，不会修改关联仓库。
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || !title.trim() || !project}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}
            创建任务
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TaskDetail({
  task,
  project,
  busy,
  initialTab,
  onClose,
  onAction,
}: {
  task: Task;
  project?: Project;
  busy: boolean;
  initialTab: string;
  onClose: () => void;
  onAction: (name: string, extra?: object) => Promise<void>;
}) {
  const [tab, setTab] = useState(initialTab),
    [events, setEvents] = useState<Event[]>([]),
    [report, setReport] = useState<Report | null>(null),
    [loadError, setLoadError] = useState("");
  const [artifact, setArtifact] = useState(reviewKinds[task.status] || "plan"),
    [draft, setDraft] = useState(""),
    [evidence, setEvidence] = useState(""),
    [decision, setDecision] = useState("completed");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [e, r] = await Promise.all([
          api(`/tasks/${task.id}/events`),
          api(`/tasks/${task.id}/report`),
        ]);
        if (live) {
          setEvents(e);
          setReport(r);
          setLoadError("");
        }
      } catch (e) {
        if (live) setLoadError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [task.id]);
  useEffect(
    () => setArtifact(reviewKinds[task.status] || "plan"),
    [task.id, task.status],
  );
  useEffect(
    () => setDraft(task.artifacts[artifact]?.content || ""),
    [task.id, artifact, task.artifacts[artifact]?.hash],
  );
  const currentKind = reviewKinds[task.status],
    canRun = ["queued", ...runningStates].includes(task.status) && !task.active;
  const names: Record<string, string> = {
    "task.created": "任务已创建",
    "artifact.saved": "产物已保存",
    "approval.recorded": "人工审批已记录",
    "task.transitioned": "阶段已更新",
    "tool.recorded": "工具证据已记录",
    "run.checkpoint": "执行检查点已保存",
    "verification.recorded": "验证结果已记录",
    "delivery.summary_recorded": "执行摘要已记录",
    "run.pending_resolved": "中断操作已核对",
    "task.lease_acquired": "执行器已取得租约",
    "task.lease_released": "执行器已释放租约",
  };
  async function download() {
    const r = await api(`/tasks/${task.id}/report`);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(r, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `devos-${task.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal drawer onClose={onClose}>
      <header className="detail-heading">
        <span>
          <GitBranch size={15} />
          {task.id.slice(0, 8)} <ChevronRight size={14} />
          {project?.name}
        </span>
        <button
          className="icon-button"
          aria-label="关闭任务详情"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="detail-title">
        <Badge task={task} />
        <h2>{task.goal}</h2>
        <p>
          {project?.repository} <span>·</span> {stamp(task.createdAt)}
        </p>
      </div>
      <div className="detail-tabs">
        {[
          ["overview", "任务概览"],
          ["artifacts", "产物与审批"],
          ["events", "执行事件"],
          ["report", "交付报告"],
        ].map(([v, l]) => (
          <button
            key={v}
            className={tab === v ? "chosen" : ""}
            onClick={() => setTab(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="detail-body">
        {loadError && (
          <div className="error" role="alert">
            {loadError}
          </div>
        )}
        {tab === "overview" && (
          <>
            <section className="detail-section">
              <h3>执行进度</h3>
              <div className="stage-list">
                {[
                  ["需求目标", "intent"],
                  ["验收规格", "spec"],
                  ["执行计划", "plan"],
                ].map(([label, kind]) => (
                  <div key={kind}>
                    <span
                      className={
                        task.artifacts[kind] && task.status !== `${kind}_review`
                          ? "stage-circle checked"
                          : "stage-circle"
                      }
                    >
                      {task.artifacts[kind] &&
                      task.status !== `${kind}_review` ? (
                        <Check size={15} />
                      ) : (
                        <Circle size={12} />
                      )}
                    </span>
                    <div>
                      <strong>{label}</strong>
                      <small>
                        {task.artifacts[kind]
                          ? task.status === `${kind}_review`
                            ? "等待你的确认"
                            : "已进入后续阶段"
                          : "尚未生成"}
                      </small>
                    </div>
                  </div>
                ))}
                <div>
                  <span
                    className={`stage-circle ${task.status === "completed" ? "checked" : ""}`}
                  >
                    {task.status === "completed" ? (
                      <Check size={15} />
                    ) : (
                      <Play size={13} />
                    )}
                  </span>
                  <div>
                    <strong>执行、验证与交付</strong>
                    <small>
                      {task.status === "completed"
                        ? "Mock 验证通过，业务需求仍待人工验收"
                        : task.active
                          ? "执行器正在后台推进"
                          : "审批后可启动"}
                    </small>
                  </div>
                </div>
              </div>
            </section>
            <div className="detail-note">
              <Terminal size={18} />
              <span>
                独立样例工作区 · 未修改业务仓库
                <br />
                <small>
                  本轮仅验证流程，使用固定 add 函数样例与真实 Node 断言。
                </small>
              </span>
            </div>
            <div className="detail-metrics">
              <div>
                <span>修复轮次</span>
                <b>{task.repairs} / 2</b>
              </div>
              <div>
                <span>验证结果</span>
                <b>
                  {task.verification === "passed"
                    ? "通过"
                    : task.verification === "failed"
                      ? "失败"
                      : "未运行"}
                </b>
              </div>
              <div>
                <span>模型调用</span>
                <b>0 次</b>
              </div>
            </div>
            {task.stopReason && (
              <p className="muted">停止原因：{task.stopReason}</p>
            )}
          </>
        )}
        {tab === "artifacts" && (
          <>
            <div className="artifact-tabs">
              {Object.entries(kinds).map(([key, label]) => (
                <button
                  key={key}
                  className={artifact === key ? "chosen" : ""}
                  onClick={() => setArtifact(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="artifact-label">
              {kinds[artifact]}
              <small>
                {artifact === currentKind
                  ? "可编辑，保存后再审批"
                  : "历史产物 / 只读"}
              </small>
              <textarea
                aria-label="产物内容"
                rows={15}
                value={draft}
                readOnly={artifact !== currentKind}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            {artifact === currentKind && (
              <button
                className="secondary"
                disabled={busy || !draft.trim()}
                onClick={() =>
                  onAction("artifact", { kind: artifact, content: draft })
                }
              >
                保存产物
              </button>
            )}
          </>
        )}
        {tab === "events" && (
          <>
            <h3>
              事件时间线 <span className="muted">{events.length}</span>
            </h3>
            <div className="event-list">
              {events.map((e) => (
                <div key={e.sequence}>
                  <span className="event-dot" />
                  <section>
                    <strong>{names[e.type] || e.type}</strong>
                    <small>
                      {e.payload.status
                        ? statuses[e.payload.status]
                        : e.payload.kind
                          ? kinds[e.payload.kind]
                          : e.payload.record?.command ||
                            e.payload.record?.path ||
                            e.payload.verdict ||
                            "事件已持久化"}{" "}
                      · {stamp(e.payload.occurredAt)}
                    </small>
                    {e.payload.record?.tool === "command" && (
                      <code>
                        退出码 {e.payload.record.exitCode ?? "—"} · 修复轮次{" "}
                        {e.payload.attempt}
                      </code>
                    )}
                  </section>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "report" && report && (
          <>
            <div className="report-box">
              <FileCheck2 size={25} />
              <h3>
                {task.status === "completed" ? "Mock 执行报告" : "当前任务报告"}
              </h3>
              <p>需求验收：待人工审查</p>
              <span className="mono muted">{report.id.slice(0, 16)}</span>
            </div>
            <p className="report-summary">
              {report.deliverySummary ||
                "任务尚无执行摘要。未执行的检查不会标记为通过。"}
            </p>
            <h3>当前轮次检查</h3>
            <div className="checks">
              {report.checks.map((c) => (
                <div key={c.check}>
                  <span>{c.check}</span>
                  <span
                    className={`badge ${c.verdict === "passed" ? "green" : c.verdict === "failed" ? "red" : "gray"}`}
                  >
                    {c.verdict === "passed"
                      ? "通过"
                      : c.verdict === "failed"
                        ? "失败"
                        : "未运行"}
                  </span>
                </div>
              ))}
            </div>
            <h3>真实命令历史</h3>
            <div className="checks">
              {report.tools.filter((t) => t.record.tool === "command")
                .length === 0 ? (
                <p className="muted">暂无命令执行证据</p>
              ) : (
                report.tools
                  .filter((t) => t.record.tool === "command")
                  .map((t, i) => (
                    <div key={i}>
                      <span>
                        {t.record.command} · 第 {t.attempt + 1} 次执行
                      </span>
                      <code>exit {t.record.exitCode ?? "—"}</code>
                    </div>
                  ))
              )}
            </div>
            <button
              className="secondary"
              onClick={() => download().catch((e) => setLoadError(e.message))}
            >
              <ArrowDownToLine size={15} />
              下载 JSON 报告
            </button>
          </>
        )}
        {task.status === "paused" && (
          <section className="recovery">
            <h3>核对中断操作</h3>
            <p>确认实际副作用后再恢复。核对依据将保存为哈希。</p>
            <select
              aria-label="核对结论"
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
            >
              <option value="completed">确认操作已完成</option>
              <option value="not_executed">确认操作未执行</option>
            </select>
            <textarea
              aria-label="核对依据"
              placeholder="填写检查过程和结论依据"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || !evidence.trim()}
              onClick={() => onAction("resolve", { decision, evidence })}
            >
              保存核对并恢复排队
            </button>
          </section>
        )}
      </div>
      <footer className="detail-actions">
        <span>
          <ShieldCheck size={14} />
          本机操作者审批
        </span>
        <div>
          {(task.active || ["queued", "paused"].includes(task.status)) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => onAction("cancel")}
            >
              <Square size={13} />
              取消任务
            </button>
          )}
          {currentKind && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                if (
                  tab === "artifacts" &&
                  artifact === currentKind &&
                  draft !== task.artifacts[currentKind]?.content
                ) {
                  setLoadError("请先保存产物，再审批");
                  return;
                }
                void onAction("approve");
              }}
            >
              <Check size={16} />
              批准{kinds[currentKind]}
            </button>
          )}
          {canRun && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => onAction("run")}
            >
              <Play size={15} />
              {task.status === "queued" ? "启动 Mock 执行" : "恢复检查点"}
            </button>
          )}
        </div>
      </footer>
    </Modal>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
