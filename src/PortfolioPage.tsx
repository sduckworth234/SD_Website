import {
  Aperture, ArrowDown, ArrowUpRight, Clock3, Download,
  FileText, Layers3, LockKeyhole, Mail, MapPin, Plane,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./components/Header";
import { getGalleryData } from "./lib/supabase";
import { useSeo } from "./lib/seo";
import type { Photo } from "./types";

const REPORTS = {
  thesis: "/portfolio/reports/sam-duckworth-honours-thesis.pdf",
  thesisPresentation: "/portfolio/reports/sam-duckworth-honours-presentation.pdf",
  tennis: "/portfolio/reports/autonomous-tennis-analysis-report.pdf",
  tennisPresentation: "/portfolio/reports/autonomous-tennis-analysis-presentation.pdf",
};

const JUMP_LINKS = [
  { n: "01", when: "2025", title: "Honours thesis", note: "First Class · UAV vision", href: "#thesis" },
  { n: "02", when: "Ongoing", title: "Daily OS", note: "Agentic personal dashboard", href: "#dailyos" },
  { n: "03", when: "2024", title: "Computer vision", note: "AMME5710 major project", href: "#vision" },
  { n: "04", when: "2021–present", title: "Photography", note: "samduckworth.com", href: "#photography" },
];

const FINDINGS = [
  {
    title: "Created a benchmark dataset",
    body: "Captured eight synchronised low-light UAV sequences with OptiTrack ground truth in the Bennett Lab.",
  },
  {
    title: "Built a modular test pipeline",
    body: "Integrated five enhancement methods with ROS and ORB-SLAM3 for controlled, repeatable comparison.",
  },
  {
    title: "Measured failure thresholds",
    body: "Established the illumination range where localisation degrades and identified temporal enhancement artefacts that reduce feature stability.",
  },
];

function ReportActions({ report, presentation }: { report: string; presentation: string }) {
  return (
    <div className="portfolio-report-actions">
      <div className="portfolio-report-buttons">
        <a href={report} target="_blank" rel="noopener noreferrer"><FileText size={15} /> Read report</a>
        <a href={report} download><Download size={15} /> Download PDF</a>
      </div>
      <a className="portfolio-report-link" href={presentation} target="_blank" rel="noopener noreferrer">View presentation <ArrowUpRight size={14} /></a>
    </div>
  );
}

function ThesisPipelineDiagram() {
  return (
    <svg className="pipeline-diagram" viewBox="0 0 1040 380" role="img" aria-labelledby="pipeline-title">
      <title id="pipeline-title">Low-light SLAM evaluation pipeline: capture, optional enhancement, then ORB-SLAM3</title>
      <defs>
        <marker id="pd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 Z" className="pd-arrowhead" />
        </marker>
      </defs>

      <g className="pd-box">
        <rect x="16" y="132" width="132" height="100" rx="6" />
        <text x="82" y="118" className="pd-label">Input feed</text>
        <text x="82" y="172" className="pd-line">DJI Mini 4 Pro</text>
        <text x="82" y="196" className="pd-line pd-muted">TurtleBot3 (sim)</text>
      </g>

      <path d="M148,182 H210" className="pd-edge" markerEnd="url(#pd-arrow)" />

      <g className="pd-box">
        <rect x="210" y="132" width="120" height="100" rx="6" />
        <text x="270" y="118" className="pd-label">Bag conversion</text>
        <text x="270" y="176" className="pd-line">ROS bag</text>
        <text x="270" y="200" className="pd-line pd-muted">timing · topics</text>
      </g>

      <path d="M330,146 V28 H700 V58" className="pd-edge pd-dashed" markerEnd="url(#pd-arrow)" />
      <text x="500" y="20" className="pd-tag">raw</text>

      <path d="M330,215 Q365,260 420,260" className="pd-edge" markerEnd="url(#pd-arrow)" />

      <g className="pd-box">
        <rect x="420" y="70" width="200" height="290" rx="6" />
        <text x="520" y="56" className="pd-label">LLIE model selection</text>
        {["CLAHE", "Histogram equalisation", "Zero-DCE++", "EnlightenGAN", "SCI"].map((m, i) => (
          <g key={m}>
            <rect x="438" y={92 + i * 48} width="164" height="34" rx="4" className="pd-chip" />
            <text x="520" y={92 + i * 48 + 22} className="pd-chip-text">{m}</text>
          </g>
        ))}
      </g>

      <path d="M620,215 H660" className="pd-edge" markerEnd="url(#pd-arrow)" />
      <text x="628" y="205" className="pd-tag">enhanced</text>

      <g className="pd-box">
        <rect x="660" y="60" width="250" height="230" rx="6" />
        <text x="785" y="46" className="pd-label">ORB-SLAM3</text>
        <rect x="676" y="86" width="105" height="184" rx="4" className="pd-chip" />
        <text x="728" y="108" className="pd-chip-text pd-chip-title">Front end</text>
        <text x="728" y="132" className="pd-chip-text pd-muted">Feature</text>
        <text x="728" y="150" className="pd-chip-text pd-muted">extraction &amp;</text>
        <text x="728" y="168" className="pd-chip-text pd-muted">tracking</text>
        <rect x="789" y="86" width="105" height="184" rx="4" className="pd-chip" />
        <text x="841" y="108" className="pd-chip-text pd-chip-title">Back end</text>
        <text x="841" y="132" className="pd-chip-text pd-muted">Mapping &amp;</text>
        <text x="841" y="150" className="pd-chip-text pd-muted">loop</text>
        <text x="841" y="168" className="pd-chip-text pd-muted">closure</text>
      </g>

      <path d="M785,290 V320" className="pd-edge" markerEnd="url(#pd-arrow)" />

      <g className="pd-box">
        <rect x="660" y="320" width="250" height="52" rx="6" className="pd-output" />
        <text x="785" y="352" className="pd-line pd-output-text">Trajectory &amp; map output</text>
      </g>

      <path d="M932,346 H960 V178 H894" className="pd-edge pd-loop" markerEnd="url(#pd-arrow)" />
      <text x="960" y="260" className="pd-tag pd-tag-vert" transform="rotate(90 960 260)">loop closure</text>
    </svg>
  );
}

function DailyOSArchitectureDiagram() {
  return (
    <svg className="pipeline-diagram" viewBox="0 0 1000 260" role="img" aria-labelledby="daily-os-title">
      <title id="daily-os-title">Daily OS input, AI classification, secure persistence and product outputs</title>
      <defs>
        <marker id="do-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 Z" className="pd-arrowhead" />
        </marker>
      </defs>

      <g className="pd-box">
        <rect x="16" y="65" width="170" height="130" rx="6" />
        <text x="101" y="51" className="pd-label">Input</text>
        <text x="101" y="122" className="pd-line">Natural language</text>
        <text x="101" y="146" className="pd-line pd-muted">Quick-add · Gmail</text>
      </g>

      <path d="M186,130 H244" className="pd-edge" markerEnd="url(#do-arrow)" />

      <g className="pd-box">
        <rect x="244" y="40" width="230" height="180" rx="6" />
        <text x="359" y="26" className="pd-label">AI classification</text>
        <g>
          <rect x="260" y="60" width="198" height="66" rx="4" className="pd-chip" />
          <text x="359" y="86" className="pd-chip-text pd-chip-title">Gemini 2.5 Flash</text>
          <text x="359" y="108" className="pd-chip-text pd-muted">Classifies user input</text>
        </g>
        <g>
          <rect x="260" y="136" width="198" height="66" rx="4" className="pd-chip" />
          <text x="359" y="162" className="pd-chip-text pd-chip-title">Claude agent</text>
          <text x="359" y="184" className="pd-chip-text pd-muted">Processes selected email</text>
        </g>
      </g>

      <path d="M474,130 H532" className="pd-edge" markerEnd="url(#do-arrow)" />

      <g className="pd-box">
        <rect x="532" y="55" width="200" height="150" rx="6" />
        <text x="632" y="41" className="pd-label">Secure persistence</text>
        <text x="632" y="90" className="pd-line">Supabase</text>
        <text x="632" y="114" className="pd-line pd-muted">Postgres · row-level security</text>
        <g>
          <rect x="550" y="136" width="164" height="30" rx="4" className="pd-chip" />
          <text x="632" y="156" className="pd-chip-text">tasks · trades · memory</text>
        </g>
      </g>

      <path d="M732,130 H790" className="pd-edge" markerEnd="url(#do-arrow)" />

      <g className="pd-box">
        <rect x="790" y="40" width="194" height="180" rx="6" />
        <text x="887" y="26" className="pd-label">Product surfaces</text>
        {["Task list", "Finance dashboard", "Morning briefing"].map((m, i) => (
          <g key={m}>
            <rect x="806" y={58 + i * 44} width="162" height="34" rx="4" className="pd-chip" />
            <text x="887" y={58 + i * 44 + 21} className="pd-chip-text">{m}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function TaskDashboardMockup() {
  const tasks = [
    ["Review prototype test results", "Today · 10:30", "important"],
    ["Prepare project demonstration", "Tomorrow · 14:00", "admin"],
    ["Refine portfolio case study", "Friday", "focus"],
    ["Follow up with fabrication team", "Waiting on", "waiting"],
  ];
  return (
    <div className="dashboard-window" aria-label="Illustrative task dashboard with fictional data">
      <div className="dashboard-sidebar">
        <div className="dashboard-brand"><span>◒</span><b>Daily OS</b></div>
        {['Overview', 'Finance', 'Budget', 'Briefing'].map((item, index) => <span className={index === 0 ? "is-active" : ""} key={item}>{item}</span>)}
        <small>Private workspace</small>
      </div>
      <div className="dashboard-main">
        <div className="dashboard-topline"><span>Monday, 31 August</span><i>Demo data</i></div>
        <label className="dashboard-quick-add">✦&nbsp;&nbsp; Add a task in natural language…</label>
        <div className="dashboard-stats">
          <span><small>Open tasks</small><b>12</b></span><span><small>Due today</small><b>3</b></span><span><small>This week</small><b>7</b></span>
        </div>
        <div className="dashboard-board">
          <div className="dashboard-task-list">
            <div className="dashboard-list-heading"><b>Today</b><small>4 tasks</small></div>
            {tasks.map(([title, due, tone], index) => (
              <div className="dashboard-task" key={title}>
                <span className={`dashboard-check ${tone}`}>{index === 3 ? <Clock3 size={10} /> : null}</span>
                <div><b>{title}</b><small>{due}</small></div><i>•••</i>
              </div>
            ))}
          </div>
          <aside className="dashboard-side-card">
            <small>This week</small><b>Weekly overview</b>
            <div className="mini-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span></div>
            <p>Tasks, deadlines and follow-ups in one view.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function FinanceDashboardMockup() {
  const bars = [38, 44, 41, 52, 57, 54, 68, 65, 76, 73, 86, 92];
  return (
    <div className="dashboard-window finance-window" aria-label="Illustrative finance dashboard with fictional data">
      <div className="dashboard-sidebar">
        <div className="dashboard-brand"><span>◒</span><b>Daily OS</b></div>
        {['Overview', 'Finance', 'Budget', 'Briefing'].map((item, index) => <span className={index === 1 ? "is-active" : ""} key={item}>{item}</span>)}
        <small>Private workspace</small>
      </div>
      <div className="dashboard-main">
        <div className="dashboard-topline"><strong>Finance</strong><i>Illustrative values</i></div>
        <div className="finance-ticker"><span>AUS +0.42%</span><span>WORLD +0.81%</span><span>TECH −0.14%</span></div>
        <div className="finance-summary">
          <div><small>Portfolio value</small><b>A$84,320</b><em>+12.4% all time</em></div>
          <div><small>Today</small><b>+A$486</b><em>+0.58%</em></div>
          <div><small>Cash</small><b>A$6,240</b><em>7.4% allocation</em></div>
        </div>
        <div className="finance-grid">
          <div className="finance-chart-card">
            <div><b>Portfolio growth</b><small>12 months</small></div>
            <div className="finance-bars" aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
            <div className="finance-axis"><span>Sep</span><span>Dec</span><span>Mar</span><span>Jun</span><span>Aug</span></div>
          </div>
          <div className="finance-holdings">
            <div><b>Holdings</b><small>Allocation</small></div>
            {[['Global equity', '46%', '+8.2%'], ['Australian equity', '31%', '+5.4%'], ['Fixed income', '15%', '+1.8%'], ['Cash', '8%', 'N/A']].map((row) => (
              <p key={row[0]}><span><b>{row[0]}</b><small>{row[1]}</small></span><em>{row[2]}</em></p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const [dashboardView, setDashboardView] = useState<"tasks" | "finance">("tasks");
  const [photos, setPhotos] = useState<Photo[]>([]);

  useSeo("Sam Duckworth Professional Portfolio", {
    path: "/portfolio",
    image: "/portfolio/og-simple-v2.png",
    description: "Data and AI, mechatronic engineering, computer vision, agentic software and photography by Sam Duckworth.",
    type: "website",
  });

  useEffect(() => {
    let active = true;
    getGalleryData().then((data) => { if (active) setPhotos(data.photos.filter((photo) => photo.imageUrl).slice(0, 5)); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <main className="portfolio-page">
      <header className="portfolio-nav" aria-label="Portfolio navigation">
        <a className="portfolio-mark" href="/portfolio"><span>SD</span><small>Portfolio / 2026</small></a>
        <nav className="portfolio-section-nav"><a href="#work">Work</a><a href="#education">Education</a><a href="#about">About</a></nav>
        <div className="portfolio-nav-actions"><a href="/">Photography <ArrowUpRight size={14} /></a><ThemeToggle /></div>
      </header>

      <section className="portfolio-hero" aria-labelledby="portfolio-title">
        <div className="portfolio-hero-portrait">
          <img src="/portfolio/images/sam-portrait.webp" alt="Sam Duckworth" />
        </div>
        <div className="portfolio-hero-copy">
          <p className="portfolio-kicker">Mechatronic Engineering &amp; Commerce · Sydney, Australia</p>
          <h1 id="portfolio-title">Sam Duckworth</h1>
          <p className="portfolio-hero-role">Graduate Data &amp; AI Analyst at Quantium · Engineer · Photographer</p>
          <p className="portfolio-intro">I build applied AI products, computer vision systems and full-stack tools. My work spans autonomous navigation research, agentic workflow automation, portfolio analytics and a production photography platform.</p>
          <div className="portfolio-hero-meta">
            <span>BE (Mechatronic) &amp; BCom, Finance</span>
            <span>First Class Honours</span>
            <span>2021 – 2025</span>
          </div>
          <a className="portfolio-scroll" href="#work">Explore selected work <ArrowDown size={15} /></a>
        </div>
      </section>

      <nav className="portfolio-jump-nav" aria-label="Jump to a project">
        {JUMP_LINKS.map((item) => (
          <a href={item.href} key={item.n}>
            <span className="jump-meta"><span className="jump-index">{item.n}</span><span className="jump-when">{item.when}</span></span>
            <b>{item.title}</b>
            <small>{item.note}</small>
          </a>
        ))}
      </nav>

      <section className="portfolio-work" id="work">
        <div className="portfolio-section-heading"><p className="portfolio-kicker">Selected work / 01–04</p><h2>Selected projects.</h2></div>

        <article className="portfolio-case thesis-case" id="thesis">
          <div className="portfolio-case-number">01</div>
          <div className="portfolio-case-copy">
            <p className="portfolio-case-type"><Plane size={14} /> Honours research · First Class · 2025</p>
            <h3>Illuminating the Unknown</h3>
            <p className="portfolio-case-deck">Reconstructing vision for UAV SLAM in low-light environments.</p>
            <p>Designed and executed an end-to-end evaluation of whether low-light image enhancement improves UAV localisation. I built a modular ROS and ORB-SLAM3 pipeline, integrated five enhancement methods and measured performance from image consistency through feature matching to trajectory accuracy.</p>
            <p>Key finding: brighter imagery did not reliably improve navigation. Temporal enhancement artefacts reduced feature stability, while raw ORB-SLAM3 remained robust until illumination fell below approximately 15 to 20%.</p>
            <div className="portfolio-tags">{['ROS', 'ORB-SLAM3', 'Python', 'OpenCV', 'OptiTrack', 'UAV systems', 'Computer vision'].map((tag) => <span key={tag}>{tag}</span>)}</div>
            <ReportActions report={REPORTS.thesis} presentation={REPORTS.thesisPresentation} />
          </div>
          <div className="portfolio-thesis-visual">
            <div className="pipeline-diagram-scroll"><ThesisPipelineDiagram /></div>
            <div className="portfolio-research-metrics"><span><strong>8</strong> UAV sequences</span><span><strong>5</strong> enhancement methods</span><span><strong>3</strong> evaluation levels</span><span><strong>30 Hz</strong> source pipeline</span></div>
          </div>
          <div className="portfolio-findings">
            {FINDINGS.map((f) => (
              <div key={f.title}><h4>{f.title}</h4><p>{f.body}</p></div>
            ))}
          </div>
        </article>

        <article className="portfolio-case dashboard-case" id="dailyos">
          <div className="portfolio-case-number">02</div>
          <div className="portfolio-case-copy dashboard-copy">
            <p className="portfolio-case-type"><LockKeyhole size={14} /> Private product · Agentic workflows · Ongoing</p>
            <h3>Daily OS</h3>
            <p className="portfolio-case-deck">A private AI-enabled workspace for tasks, finance, budgeting and daily briefings.</p>
            <p>Built with Next.js, TypeScript and Supabase. Gemini 2.5 Flash classifies natural-language inputs into tasks, trades and recurring expenses. A scheduled Claude agent converts selected emails into tasks using confidence rules and sender history.</p>
            <p>The finance module reconstructs holdings from transactions, tracks performance and allocation, and surfaces relevant market context. Authentication and row-level security protect all personal data.</p>
            <div className="portfolio-tags">{['Next.js', 'TypeScript', 'Supabase', 'PostgreSQL', 'Gemini 2.5', 'Claude agents', 'Portfolio tracking', 'Vercel'].map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>
          <div className="dashboard-showcase">
            <div className="dashboard-switch"><button className={dashboardView === "tasks" ? "is-active" : ""} onClick={() => setDashboardView("tasks")} type="button">Task workspace</button><button className={dashboardView === "finance" ? "is-active" : ""} onClick={() => setDashboardView("finance")} type="button">Finance workspace</button><span><LockKeyhole size={12} /> Mockup · dummy data</span></div>
            {dashboardView === "tasks" ? <TaskDashboardMockup /> : <FinanceDashboardMockup />}
          </div>
          <div className="portfolio-architecture">
            <div className="pipeline-diagram-scroll"><DailyOSArchitectureDiagram /></div>
          </div>
        </article>

        <article className="portfolio-case tennis-case" id="vision">
          <div className="portfolio-case-number">03</div>
          <div className="portfolio-case-copy">
            <p className="portfolio-case-type"><Layers3 size={14} /> AMME5710 · Computer Vision major project</p>
            <h3>Autonomous Tennis Analysis</h3>
            <p className="portfolio-case-deck">A near-real-time player and ball tracking pipeline from a single broadcast feed.</p>
            <p>Built a single-camera computer vision pipeline to classify gameplay frames, detect court geometry and track players and the ball from 25 FPS broadcast footage.</p>
            <p>Used homography to project detections into a live bird&rsquo;s-eye view and tested the pipeline across all four Grand Slam tournaments. The gameplay classifier achieved 0.963 precision and 0.962 accuracy.</p>
            <div className="portfolio-tags">{['Classical CV', 'KNN', 'MOG2', 'Homography', 'Object tracking', 'Python', 'OpenCV'].map((tag) => <span key={tag}>{tag}</span>)}</div>
            <ReportActions report={REPORTS.tennis} presentation={REPORTS.tennisPresentation} />
          </div>
          <figure className="portfolio-tennis-visual">
            <img src="/portfolio/images/tennis-architecture.webp" alt="System architecture for the autonomous tennis analysis pipeline" loading="lazy" />
            <figcaption>Classification → court &amp; corner detection → player/ball tracking → homography → bird&rsquo;s-eye overlay.</figcaption>
          </figure>
        </article>

        <article className="portfolio-case photography-case" id="photography">
          <div className="portfolio-case-number">04</div>
          <div className="portfolio-case-copy">
            <p className="portfolio-case-type"><Aperture size={14} /> Photography &amp; digital commerce</p>
            <h3>Sam Duckworth Photography</h3>
            <p className="portfolio-case-deck">A photography portfolio and commerce platform designed and built end to end.</p>
            <p>Built the public gallery, map-based discovery, responsive image delivery, admin CMS and structured photo catalogue for aerial, coastal, travel and commissioned work.</p>
            <p>Integrated secure checkout, configurable print pricing and fulfilment workflows using Stripe and Supabase.</p>
            <div className="portfolio-tags">{['React', 'Vite', 'Supabase', 'MapLibre', 'Stripe', 'Digital asset workflows'].map((tag) => <span key={tag}>{tag}</span>)}</div>
            <a className="portfolio-primary-link" href="/">Visit samduckworth.com <ArrowUpRight size={15} /></a>
          </div>
          <div className={`portfolio-photo-grid ${photos.length ? "has-photos" : ""}`}>
            {photos.slice(0, 5).map((photo) => <figure key={photo.id}><img src={photo.imageUrl} alt={photo.title} loading="lazy" decoding="async" /><figcaption>{photo.title} · {photo.location}</figcaption></figure>)}
            {!photos.length ? <div className="portfolio-photo-placeholder"><Aperture size={32} /><span>Loading the photographic archive</span></div> : null}
          </div>
        </article>
      </section>

      <section className="portfolio-education" id="education">
        <div className="portfolio-section-heading portfolio-section-heading-compact"><p className="portfolio-kicker">Education / University of Sydney</p></div>
        <div className="portfolio-degree">
          <div>
            <span>2021–2025</span>
            <h3>Bachelor of Engineering (Mechatronic), First Class Honours &amp; Bachelor of Commerce, Finance</h3>
            <p>The University of Sydney · School of Aerospace, Mechanical and Mechatronic Engineering</p>
          </div>
          <img src="/portfolio/images/usyd-crest.png" alt="University of Sydney crest" className="portfolio-degree-crest" loading="lazy" />
        </div>
        <div className="portfolio-study-grid">
          <article><span>01</span><h3>Autonomy &amp; robotics</h3><p>ROS, localisation, mapping, sensors, real-time control.</p></article>
          <article><span>02</span><h3>Computer vision</h3><p>Feature extraction, tracking, calibration, image enhancement.</p></article>
          <article><span>03</span><h3>Mechanical systems</h3><p>Mechatronic design, dynamics, materials, embedded systems.</p></article>
          <article><span>04</span><h3>Computation</h3><p>Python, C/C++, simulation, numerical methods.</p></article>
          <article><span>05</span><h3>Finance &amp; markets</h3><p>Investment analysis, corporate finance, portfolio construction.</p></article>
          <article><span>06</span><h3>Engineering practice</h3><p>Team projects, technical communication, systems thinking.</p></article>
        </div>
      </section>

      <section className="portfolio-about" id="about">
        <div className="portfolio-about-image"><img src="/about-sam.webp" alt="Sam Duckworth" loading="lazy" /></div>
        <div className="portfolio-about-copy">
          <p className="portfolio-kicker">Contact</p>
          <h2>Let&rsquo;s connect.</h2>
          <p>Open to conversations about data, applied AI, automation, computer vision and digital products.</p>
          <div className="portfolio-about-details">
            <a href="mailto:samduckworthphoto@gmail.com"><Mail size={14} /> samduckworthphoto@gmail.com</a>
            <span><MapPin size={14} /> Sydney, Australia</span>
          </div>
        </div>
      </section>

      <footer className="portfolio-footer">
        <p>Sam Duckworth</p>
        <div><span>Portfolio · 2026</span><a href="/">samduckworth.com <ArrowUpRight size={14} /></a></div>
      </footer>
    </main>
  );
}
