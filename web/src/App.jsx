import { useEffect, useState } from "react";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import ModeToggle from "./components/ModeToggle.jsx";
import PresenterSay from "./components/PresenterSay.jsx";
import useLab from "./hooks/useLab";
import FallbackPage from "./pages/FallbackPage.jsx";
import DiagramPage from "./pages/DiagramPage.jsx";
import StoriesPage from "./pages/StoriesPage.jsx";
import LimitsPage from "./pages/LimitsPage.jsx";
import { visible } from "./safeText";
import { FORGOTTEN_EVENT } from "./workspace.js";
import { dialogItems } from "./talk";

export const PAGES = [
  { id: "fallback", label: "Fallback", View: FallbackPage },
  { id: "diagram", label: "Diagram", View: DiagramPage },
  { id: "stories", label: "Stories and talk track", View: StoriesPage },
  { id: "limits", label: "Limits (UNVERIFIED)", View: LimitsPage },
];
// Shown until the server's own banner has loaded: never blank, and never claiming more than it knows.
export const BANNER_UNKNOWN = "SIMULATED. Mock LLM key, mock model providers and a lab clock; nothing leaves this machine. Everything beyond the 2026-11-21 release-notes sentence is this lab's own model and UNVERIFIED.";
// One line per page above the content.
const PAGE_INTRO = {
  fallback: "An LLM key names an ordered chain of models. Run a scenario or your own prompt: the verdict says which model answered, or names the refusal, then every attempt, each model's own budget and what the run left behind.",
  diagram: "The flow from the app to the models, drawn from diagram-studio data. Drag the boxes, Simulate the arrows, Reset puts everything back.",
  stories: "Nine stories as data, told for an invented company. Each one opens the scenario it teaches. The talk track is the script behind them.",
  limits: "Exactly what the release notes say, and what is this lab's own model.",
};
// Which talk-track items the presenter sees on each page (ids from the server's talkTrack). The Fallback page shows the story of the scenario in view.
const PRESENTER_TALK = { diagram: ["what-is-simulated-and-what-is-not"], limits: ["what-is-simulated-and-what-is-not"], stories: ["before-you-start"] };
const THEME_KEY = "pmf.theme";
const FONT_KEY = "pmf.font";
const THEMES = ["auto", "light", "dark"];
function initialTheme() { try { const v = localStorage.getItem(THEME_KEY); if (THEMES.includes(v)) return v; } catch { /* storage blocked */ } return "auto"; }
function initialFont() { try { const f = localStorage.getItem(FONT_KEY); return ["S", "M", "L"].includes(f) ? f : "M"; } catch { return "M"; } }
// "#fallback/<scenario>" opens the Fallback page and runs that scenario: the page is the part before the slash.
// A key typed into a field is never a shortcut; "P" is not one either when it is aimed at the focused button, link or an editable area.
export const inField = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable === true);
export const inControl = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable === true);
const pageFromHash = () => { const h = window.location.hash.replace("#", "").split("/")[0]; return PAGES.some((p) => p.id === h) ? h : "fallback"; };

export default function App() {
  const lab = useLab();
  const [page, setPage] = useState(pageFromHash());
  const [presenter, setPresenter] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [theme, setTheme] = useState(initialTheme);
  const [fontStep, setFontStep] = useState(initialFont);
  const [resetMsg, setResetMsg] = useState("");
  const [forgotten, setForgotten] = useState(false);

  // The server forgot this tab's workspace (a restart, or more than 20 workspaces): say so plainly and read the key and state again.
  const { resync } = lab; // the scenario hash goes too, or the remount would run its scenario again
  useEffect(() => { const on = () => { setForgotten(true); clearScenarioHash(); resync(); }; window.addEventListener(FORGOTTEN_EVENT, on); return () => window.removeEventListener(FORGOTTEN_EVENT, on); }, [resync]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (lab.last?.runId) setResetMsg(""); }, [lab.last?.runId]); // the Reset note belongs to the moment of the reset, not to the run after it
  useEffect(() => { if (lab.epoch > 0) clearScenarioHash(); }, [lab.epoch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (theme === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { applyFontSize(fontStep); try { localStorage.setItem(FONT_KEY, fontStep); } catch { /* not remembered */ } }, [fontStep]);
  useEffect(() => { const on = () => setPage(pageFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => {
    const on = (e) => {
      if (e.key === "Escape") { setPresenter(false); return; } // leaves presenter mode from anywhere, a field included
      if (inField(e.target)) return; // typing
      if ((e.key === "p" || e.key === "P") && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !inControl(e.target)) setPresenter((v) => !v); // never Ctrl/Cmd+P (print), a held key or a key aimed at a focused control
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const pickTheme = (next) => { try { if (next === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, next); } catch { /* not remembered */ } setTheme(next); };
  const select = (id) => { setPage(id); try { window.history.replaceState(null, "", `#${id}`); } catch { /* ignore */ } };
  // A new epoch (Reset, a new vertical, a mode switch) remounts the page; "#fallback/<scenario>" would run that scenario again, so the scenario part goes.
  const clearScenarioHash = () => { try { if (window.location.hash.includes("/")) window.history.replaceState(null, "", `#${pageFromHash()}`); } catch { /* ignore */ } };
  const reset = async () => {
    clearScenarioHash();
    setForgotten(false);
    const ok = await lab.reset();
    setResetMsg(ok ? "Reset: the key is back to its default chain with empty budgets, the lab clock is at zero, the last run is cleared and the diagram is back in place." : "Reset failed on the server; the view was reloaded.");
  };

  const { source, story, info } = lab;
  const banner = info?.banner || BANNER_UNKNOWN;
  const View = PAGES.find((p) => p.id === page).View;
  const sc = lab.last?.scenario ? story?.stories.find((s) => s.scenario === lab.last.scenario.id) : null;
  const say = !story ? [] : page === "fallback" ? story.talkTrack.filter((x) => x.id === (sc ? sc.id : "before-you-start")) : story.talkTrack.filter((x) => (PRESENTER_TALK[page] || []).includes(x.id));

  return (
    <div className={`app${presenter ? " app--presenter" : ""}`}>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">PMF</span>
          <h1>{visible(story?.name || "Privilege model fallback LAB")}</h1>
          {source && <span className="shell-badge" data-testid="mode" title="Mock: nothing leaves this machine">{source === "real" ? "Real" : "Mock"}</span>}
        </span>
        <nav className="shell-nav" aria-label="Lab sections">
          {PAGES.map((p) => <a key={p.id} href={`#${p.id}`} aria-current={page === p.id ? "page" : undefined} onClick={(e) => { e.preventDefault(); select(p.id); }}>{p.label}</a>)}
        </nav>
        <TopMenu
          vertical={story ? { value: lab.vertical, onChange: lab.setVertical, options: story.verticals.map((v) => v.id) } : undefined}
          theme={{ value: theme, onChange: pickTheme }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: presenter, onToggle: () => setPresenter((v) => !v), label: "Presenter (P)" }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          help={{ href: "https://github.com/curtismu7/privilege-model-fallback-LAB#readme" }}
          version={info?.version ? `v${info.version}` : null}
          onReset={reset}
          extra={<ModeToggle source={source || "mock"} info={info} onSwitch={lab.switchMode} />}
        />
      </header>
      <main className="page">
        <p className="banner" role="note" data-state={source === "real" ? "live" : "mock"} data-testid="banner">{banner}</p>
        {forgotten && (
          <p className="field-error" role="alert" data-testid="workspace-forgotten">
            The server forgot this workspace; the lab was reset to its defaults.{" "}
            <button type="button" onClick={() => setForgotten(false)} data-testid="workspace-forgotten-dismiss">Dismiss</button>
          </p>
        )}
        {lab.modeError && <p className="field-error" role="alert" data-testid="mode-error-banner">{lab.modeError}</p>}
        {lab.error && (
          <div className="field-error" role="alert" data-testid="load-error">
            <p>Could not load the lab ({lab.error}). Is the server running?</p>
            <button type="button" onClick={lab.reload} data-testid="retry">Try again</button>
          </div>
        )}
        <p className={resetMsg ? "reset-note" : "sr-only"} role="status" aria-live="polite" data-testid="reset-note">{resetMsg}</p>
        {!presenter && <div className="page-head">{story?.tagline && <p className="muted" data-testid="tagline">{visible(story.tagline)}</p>}<p className="head__intro" data-testid="head-intro">{PAGE_INTRO[page]}</p></div>}
        {presenter && <PresenterSay say={say} heading={null} />}
        <div id={`panel-${page}`}>
          {lab.error && !story ? null : !story || !info ? <p className="muted" role="status">Loading...</p> : <View key={`${page}-${lab.epoch}`} lab={lab} />}
        </div>
      </main>
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={dialogItems(story?.talkTrack ?? [])} />
    </div>
  );
}
