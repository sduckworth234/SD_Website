import {
  Aperture, ArrowDown, ArrowUpRight, Check, Clock3, Code2, Download,
  FileText, GraduationCap, Layers3, LockKeyhole, MapPin, Plane,
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

function ReportActions({ report, presentation }: { report: string; presentation: string }) {
  return (
    <div className="portfolio-report-actions">
      <a href={report} target="_blank" rel="noopener noreferrer"><FileText size={15} /> Read report</a>
      <a href={report} download><Download size={15} /> Download PDF</a>
      <a href={presentation} target="_blank" rel="noopener noreferrer">View presentation <ArrowUpRight size={14} /></a>
    </div>
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
            <small>This week</small><b>Designed around action.</b>
            <div className="mini-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span></div>
            <p>Tasks, follow-ups and the daily brief stay visible without turning the day into noise.</p>
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

  useSeo("Sam Duckworth | Engineer, Builder & Photographer", {
    path: "/portfolio",
    image: "/portfolio/og.png",
    description: "The professional portfolio of Sam Duckworth: mechatronic engineering, computer vision, autonomous systems, software products and photography.",
    type: "profile",
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
        <div className="portfolio-hero-copy">
          <p className="portfolio-kicker">Mechatronics / Computer vision / Digital products</p>
          <h1 id="portfolio-title">I build systems that make complex things feel clear.</h1>
          <p className="portfolio-intro">I&rsquo;m Sam Duckworth, a mechatronic engineering honours graduate, software builder and photographer working across autonomous systems, intelligent tools and visual storytelling.</p>
          <a className="portfolio-scroll" href="#work">Explore selected work <ArrowDown size={15} /></a>
        </div>
        <div className="portfolio-hero-index">
          <article><span>01</span><GraduationCap /><h2>Engineering</h2><p>Honours research in low-light UAV navigation and visual SLAM.</p></article>
          <article><span>02</span><Code2 /><h2>Digital products</h2><p>Personal software for planning, finance and everyday decisions.</p></article>
          <article><span>03</span><Aperture /><h2>Photography</h2><p>A growing archive of aerial, coastal and commissioned work.</p></article>
        </div>
      </section>

      <section className="portfolio-proof">
        <p><span>Degree</span><strong>BEng Mechatronic Engineering (Honours)</strong></p>
        <p><span>University</span><strong>The University of Sydney</strong></p>
        <p><span>Focus</span><strong>Robotics · Vision · Product</strong></p>
        <p><span>Based</span><strong>Sydney, Australia</strong></p>
      </section>

      <section className="portfolio-work" id="work">
        <div className="portfolio-section-heading"><p className="portfolio-kicker">Selected work / 01–04</p><h2>Research, products and practice.</h2></div>

        <article className="portfolio-case thesis-case">
          <div className="portfolio-case-number">01</div>
          <div className="portfolio-case-copy">
            <p className="portfolio-case-type"><Plane size={14} /> Honours research · 2025</p>
            <h3>Illuminating the Unknown</h3>
            <p className="portfolio-case-deck">Reconstructing vision for UAV SLAM in low-light environments.</p>
            <p>My honours thesis tested a deceptively simple idea: if a drone can see a brighter image, will it navigate better? I built a modular ROS pipeline around ORB-SLAM3, integrated five classical and learning-based low-light enhancement methods, and evaluated their effect from raw image consistency through feature matching to trajectory accuracy.</p>
            <p>The result challenged the initial hypothesis. Brighter images did not reliably improve localisation; frame-to-frame enhancement instability often disrupted the geometric features SLAM depends on. Raw ORB-SLAM3 remained robust until illumination fell below roughly 15–20%.</p>
            <div className="portfolio-tags">{['ROS', 'ORB-SLAM3', 'Python', 'OpenCV', 'OptiTrack', 'UAV systems', 'Computer vision'].map((tag) => <span key={tag}>{tag}</span>)}</div>
            <ReportActions report={REPORTS.thesis} presentation={REPORTS.thesisPresentation} />
          </div>
          <div className="portfolio-thesis-visual">
            <img src="/portfolio/images/thesis-cover.webp" alt="Cover of Sam Duckworth's honours thesis" />
            <div className="portfolio-research-metrics"><span><strong>8</strong> UAV sequences</span><span><strong>5</strong> enhancement methods</span><span><strong>3</strong> evaluation levels</span><span><strong>30 Hz</strong> source pipeline</span></div>
          </div>
          <figure className="portfolio-wide-figure"><img src="/portfolio/images/thesis-conclusion.webp" alt="Conclusion slide summarising the low-light UAV SLAM research" loading="lazy" /><figcaption>From image-level enhancement to feature stability and trajectory accuracy, a deliberately end-to-end investigation.</figcaption></figure>
        </article>

        <article className="portfolio-case tennis-case">
          <div className="portfolio-case-number">02</div>
          <div className="portfolio-case-copy">
            <p className="portfolio-case-type"><Layers3 size={14} /> AMME5710 major project · Team B</p>
            <h3>Autonomous Tennis Analysis</h3>
            <p className="portfolio-case-deck">A near-real-time player and ball tracking pipeline from a single broadcast feed.</p>
            <p>Hawk-Eye-class systems depend on many calibrated high-speed cameras. Our project explored a more accessible route: extracting player position, approximate ball trajectories and match metrics from ordinary 25 FPS television footage using a lightweight, interpretable pipeline.</p>
            <p>The system classified gameplay frames, localised the court, tracked moving players and the ball, estimated a homography and transformed detections into a live bird&rsquo;s-eye view. Testing spanned all four Grand Slam tournaments to challenge court colours, lighting and camera geometry.</p>
            <div className="portfolio-tags">{['Classical CV', 'KNN', 'MOG2', 'Homography', 'Object tracking', 'Python', 'OpenCV'].map((tag) => <span key={tag}>{tag}</span>)}</div>
            <ReportActions report={REPORTS.tennis} presentation={REPORTS.tennisPresentation} />
          </div>
          <figure className="portfolio-tennis-visual"><img src="/portfolio/images/tennis-architecture.webp" alt="System architecture for the autonomous tennis analysis pipeline" loading="lazy" /><figcaption><span><strong>0.963</strong> classification precision</span><span><strong>0.962</strong> classification accuracy</span><span><strong>25 FPS</strong> broadcast input</span></figcaption></figure>
        </article>

        <article className="portfolio-case dashboard-case">
          <div className="portfolio-case-number">03</div>
          <div className="portfolio-case-copy dashboard-copy">
            <p className="portfolio-case-type"><LockKeyhole size={14} /> Private personal product · Ongoing</p>
            <h3>Daily OS</h3>
            <p className="portfolio-case-deck">A calm command centre for tasks, finance, planning and daily intelligence.</p>
            <p>I designed and built a private, responsive dashboard that turns scattered personal information into a coherent daily workflow. Natural-language capture routes new entries into tasks, trades or recurring expenses; Supabase-backed data, row-level security and authenticated routes keep the experience personal.</p>
            <p>The finance workspace reconstructs holdings from transactions, adds live prices, performance, allocation and risk context, then connects those signals with relevant market news. The product also brings together budgeting, briefings, travel, sports and lightweight automation.</p>
            <div className="portfolio-tags">{['Next.js', 'TypeScript', 'Supabase', 'PostgreSQL', 'React Query', 'Gemini', 'Vercel'].map((tag) => <span key={tag}>{tag}</span>)}</div>
          </div>
          <div className="dashboard-showcase">
            <div className="dashboard-switch"><button className={dashboardView === "tasks" ? "is-active" : ""} onClick={() => setDashboardView("tasks")} type="button">Task workspace</button><button className={dashboardView === "finance" ? "is-active" : ""} onClick={() => setDashboardView("finance")} type="button">Finance workspace</button><span><LockKeyhole size={12} /> Mockup · dummy data</span></div>
            {dashboardView === "tasks" ? <TaskDashboardMockup /> : <FinanceDashboardMockup />}
          </div>
        </article>

        <article className="portfolio-case photography-case">
          <div className="portfolio-case-number">04</div>
          <div className="portfolio-case-copy">
            <p className="portfolio-case-type"><Aperture size={14} /> Photography & digital commerce</p>
            <h3>Sam Duckworth Photography</h3>
            <p className="portfolio-case-deck">A self-directed photographic practice and the platform built around it.</p>
            <p>An evolving archive of aerial, coastal, travel and commissioned photography, designed, photographed and engineered as one system. The site combines a location-led gallery and map with editorial curation, responsive image delivery and an end-to-end fine-art print workflow.</p>
            <p>Behind the quiet front end sits a purpose-built admin system, structured photo catalogue, secure checkout, pricing controls and optional print fulfilment. It is both a creative outlet and a long-running exercise in product craft.</p>
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
        <div className="portfolio-section-heading"><p className="portfolio-kicker">Education / University of Sydney</p><h2>Broad engineering foundations.<br />A specialist eye for intelligent systems.</h2></div>
        <div className="portfolio-degree"><div><span>2021–2025</span><h3>Bachelor of Engineering in Mechatronic Engineering (Honours)</h3><p>The University of Sydney · School of Aerospace, Mechanical and Mechatronic Engineering</p></div><GraduationCap /></div>
        <div className="portfolio-study-grid">
          <article><span>01</span><h3>Autonomy & robotics</h3><p>Robot operating systems, localisation, mapping, sensors, control and real-time systems.</p></article>
          <article><span>02</span><h3>Computer vision</h3><p>Feature extraction, tracking, calibration, geometry, image enhancement and machine learning.</p></article>
          <article><span>03</span><h3>Mechanical systems</h3><p>Mechatronic design, dynamics, solid mechanics, materials, electronics and embedded integration.</p></article>
          <article><span>04</span><h3>Computation</h3><p>Python, C/C++, data analysis, simulation, software engineering and numerical methods.</p></article>
          <article><span>05</span><h3>Finance electives</h3><p>Investment analysis, portfolio thinking, markets and the financial context for technical decisions.</p></article>
          <article><span>06</span><h3>Engineering practice</h3><p>Team projects, experimental design, technical communication, systems thinking and professional practice.</p></article>
        </div>
      </section>

      <section className="portfolio-about" id="about">
        <div className="portfolio-about-image"><img src="/about-sam.webp" alt="Sam Duckworth" loading="lazy" /></div>
        <div className="portfolio-about-copy"><p className="portfolio-kicker">About Sam</p><h2>Curious by default.<br />Practical by design.</h2><p>My best work lives where disciplines overlap: an engineer&rsquo;s need to understand the system, a builder&rsquo;s instinct to make it useful, and a photographer&rsquo;s attention to what people actually see.</p><p>I enjoy taking ambiguous problems from first principles to a considered outcome, whether that is diagnosing why a vision pipeline fails, shaping a private software product around real habits, or waiting for the right weather over Sydney&rsquo;s coastline.</p><div className="portfolio-about-details"><span><MapPin size={14} /> Sydney, Australia</span><span><Check size={14} /> Engineering · Product · Photography</span></div></div>
      </section>

      <footer className="portfolio-footer"><p>Sam Duckworth</p><h2>Engineering the useful.<br />Photographing the memorable.</h2><div><span>Portfolio · 2026</span><a href="/">samduckworth.com <ArrowUpRight size={14} /></a></div></footer>
    </main>
  );
}
