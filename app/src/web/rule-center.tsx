import React, { useEffect, useRef, useState } from "react";

type RuleRole = {
  id: string;
  title: string;
  baseText: string;
  protocolText?: string | null;
  protocolPath?: string | null;
  basePath: string;
  supplement: string;
  supplementPath: string | null;
  editable?: boolean;
  revision: string;
  baseVersion: string;
  effectiveHash: string;
  appliedHash?: string;
  appliedAt?: string;
  turnActive: boolean;
  applicationStatus: string;
};
type RuleCatalog = {
  root: string;
  roles: RuleRole[];
  skills: { title: string; description: string; path: string; loaded: boolean; content?: string }[];
  harness: { title: string; description: string; source: string }[];
  harnessGuide?: { path: string; content: string };
};
type Api = (url: string, body?: any, method?: string) => Promise<any>;

function Applied({ role }: { role: RuleRole }) {
  if (role.id === "dsh")
    return <p>DSH 的执行规则在委派工作包时提供；这里不代表已有 Session 自动更新。</p>;
  if (role.appliedHash && role.appliedHash === role.effectiveHash)
    return <p>已有当前版本的加载记录；不等于每次回答都已验证遵守规则。</p>;
  return <p>当前版本尚未记录加载，等待下一次正常对话。{role.turnActive ? "负责人正在工作，本次保存不打断当前工作。" : "查看和保存规则不会自行启动对话。"}</p>;
}

export function RuleCenter({ api }: { api: Api }) {
  const [catalog, setCatalog] = useState<RuleCatalog | null>(null);
  const [section, setSection] = useState("roles");
  const [selected, setSelected] = useState("planner");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revisions, setRevisions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api("rules").then((data: RuleCatalog) => {
      if (!mounted.current) return;
      setCatalog(data);
      setDrafts(Object.fromEntries(data.roles.map(role => [role.id, role.supplement])));
      setRevisions(Object.fromEntries(data.roles.map(role => [role.id, role.revision])));
    }).catch((e: unknown) => {
      if (mounted.current) setError("规则读取失败，请重试。" + String(e));
    }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; };
  }, [api]);

  const role = catalog?.roles.find(item => item.id === selected);
  const editable = role && role.editable !== false && ["planner", "developer"].includes(role.id);
  const changed = !!role && drafts[role.id] !== role.supplement;

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const data: RuleCatalog = await api("rules");
      setCatalog(data);
      // Re-read the current revision, keeping the user's unsaved text visible.
      setDrafts(value => Object.fromEntries(data.roles.map(item => [item.id, value[item.id] ?? item.supplement])));
      setRevisions(value => Object.fromEntries(data.roles.map(item => [item.id, item.id === selected || !value[item.id] ? item.revision : value[item.id]])));
      setConflict(false);
      setShowLatest(true);
      setNotice("已重新读取当前规则，保留你的草稿。请对照最新补充规则，合并后再保存。");
    } catch (e) { setError("重新读取失败。" + String(e)); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!role || !editable || !changed || saving.current) return;
    saving.current = true;
    setPending(true);
    setError("");
    setNotice("");
    setConflict(false);
    const id = role.id;
    const content = drafts[id];
    try {
      await api("rules/" + id, { content, expectedRevision: revisions[id] }, "PUT");
      // A successful HTTP request is followed by a read-back of the actual file.
      const data: RuleCatalog = await api("rules");
      const actual = data.roles.find(item => item.id === id);
      setCatalog(data);
      if (!actual || actual.supplement !== content)
        throw Error("回读内容与本次提交不一致，请核对最新规则后再操作。");
      setRevisions(value => ({ ...value, [id]: actual.revision }));
      setNotice("补充规则已保存并回读核对。下次正常对话加载，不中断当前任务，也不会自动发送消息。已有历史保持原样。");
    } catch (e: any) {
      if (e?.status === 409) {
        setConflict(true);
        setError("规则已被其他操作修改，本次没有覆盖。草稿已保留，请读取最新规则并合并。");
      } else {
        setError("未能确认保存结果，草稿已保留。请重新读取并核对当前文件，不要连续重复提交。" + String(e));
        setConflict(true);
      }
    } finally { saving.current = false; setPending(false); }
  }

  return <section className="card rule-center" aria-labelledby="rule-center-title">
    <h2 id="rule-center-title">AI 规则与技能</h2>
    <p>查看负责人怎么分工、有哪些专业操作说明，以及后台如何控制执行。角色补充可以在这里修改。</p>
    <nav className="actions" aria-label="规则中心分区">
      <button type="button" aria-pressed={section === "roles"} onClick={() => setSection("roles")}>角色规则</button>
      <button type="button" aria-pressed={section === "skills"} onClick={() => setSection("skills")}>操作技能</button>
      <button type="button" aria-pressed={section === "harness"} onClick={() => setSection("harness")}>执行机制</button>
    </nav>
    {loading && <p role="status">正在读取规则…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {(conflict || (!catalog && !loading)) && <button type="button" disabled={loading || pending} onClick={refresh}>读取最新规则，保留草稿</button>}
    {catalog && section === "roles" && <>
      <div className="actions" role="group" aria-label="选择负责人规则">
        {catalog.roles.map(item => <button type="button" key={item.id} disabled={pending} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setError(""); setNotice(""); setConflict(false); setShowLatest(false); }}>{item.title}</button>)}
      </div>
      {role && <section aria-label={role.title + "规则"}>
        <h3>{role.title}</h3>
        <Applied role={role}/>
        <details open>
          <summary>阅读基础角色规则</summary>
          <p>这部分随 Studio 版本维护；岗位、安全和可信工具约束不由补充规则撤销。</p>
          <textarea aria-label={role.title + "基础规则"} readOnly value={role.baseText} rows={12} style={{ width: "100%", resize: "vertical" }}/>
          {role.protocolText && <details><summary>工具协议与执行边界（随对话提供）</summary><pre style={{whiteSpace:"pre-wrap",maxHeight:360,overflow:"auto"}}>{role.protocolText}</pre><code>{role.protocolPath}</code></details>}
        </details>
        {editable ? <form onSubmit={e => { e.preventDefault(); void save(); }}>
          <h4>我的补充规则</h4>
          <p>适合填写工作偏好、汇报格式等长期约定，最多 8000 字。不授予新权限，不改变当前任务要求；清空后保存可撤销这些补充。</p>
          <label>{role.title}补充规则
            <textarea aria-label={role.title + "补充规则"} value={drafts[role.id] ?? ""} rows={8} maxLength={8000} disabled={pending} style={{ width: "100%", resize: "vertical" }} onChange={e => setDrafts(value => ({ ...value, [role.id]: e.target.value }))}/>
          </label>
          {(conflict || showLatest) && <details open><summary>当前文件中的补充规则</summary><pre style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{role.supplement || "尚无补充规则"}</pre></details>}
          <div className="actions">
            <button type="submit" className="primary" disabled={!changed || pending || conflict}>{pending ? "正在保存并核对…" : "保存补充规则"}</button>
            <button type="button" disabled={pending || !changed} onClick={() => { setDrafts(value => ({ ...value, [role.id]: role.supplement })); setRevisions(value => ({ ...value, [role.id]: role.revision })); setConflict(false); setError(""); setNotice("已恢复为当前文件中的补充规则，未发送任何消息。"); }}>撤销未保存修改</button>
          </div>
          {changed && !pending && <p>有未保存的修改。离开设置页会丢弃这些草稿。</p>}
        </form> : <p>DSH 基础执行规则由技术维护端管理；这里提供阅读，不直接改动正在执行的工作包。</p>}
        <details><summary>文件位置与加载记录</summary>
          <p>基础规则：<code>{role.basePath}</code></p>
          {role.supplementPath && <p>补充规则：<code>{role.supplementPath}</code></p>}
          <p>基础版本：{role.baseVersion}</p>
          <p>规则目录：<code>{catalog.root}</code></p>
          {role.appliedAt && <p>最近加载记录：{new Date(role.appliedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）</p>}
        </details>
      </section>}
    </>}
    {catalog && section === "skills" && <section aria-label="操作技能目录"><h3>操作技能</h3>
      <p>技能是专业操作说明。目录中列出文件，不代表某位负责人或某个 DSH Session 已实际加载；以当次执行记录为准。</p>
      {catalog.skills.length === 0 ? <p>当前尚未登记可查看的操作技能。</p> : catalog.skills.map((item, i) => <article key={item.path + i}><h4>{item.title}</h4><p>{item.description}</p><p>{item.loaded ? "有加载记录，具体范围需查看对应执行记录。" : "未证实自动加载。"}</p>{item.content && <pre style={{ whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>{item.content}</pre>}<details><summary>查看技能文件位置</summary><code>{item.path}</code></details></article>)}
    </section>}
    {catalog && section === "harness" && <section aria-label="执行机制目录"><h3>执行机制</h3>
      <p>执行机制负责权限、任务状态、测试、重试和恢复，由程序执行。查看文字或修改角色补充，不会改变这些安全边界；调整程序需开发、测试和部署。</p>
      {catalog.harnessGuide && <details open><summary>阅读执行机制说明</summary><pre style={{ whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>{catalog.harnessGuide.content}</pre><p>说明文件：<code>{catalog.harnessGuide.path}</code></p></details>}
      {catalog.harness.map((item, i) => <article key={item.source + i}><h4>{item.title}</h4><p>{item.description}</p><details><summary>查看实现位置</summary><code>{item.source}</code></details></article>)}
    </section>}
  </section>;
}
