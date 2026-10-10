import { useEffect, useRef, useState, type DragEvent } from "react";
import { ACCEPT, MAX_FILE_BYTES, defaultChoice, prettySize, type Selection, type useUpload } from "./upload";

type Upload = ReturnType<typeof useUpload>;

/** The first file in a drop, if any. */
export function droppedFile(e: DragEvent): File | null {
  return e.dataTransfer?.files?.[0] ?? null;
}

/** True while a drag carries files (not text or a link). */
export function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

interface Props {
  upload: Upload;
  sel: Selection;
}

/** Choose (or drop) a MusicXML file, then the movement and bars to arrange. */
export function UploadPanel({ upload, sel }: Props) {
  const { stage, choice, setChoice, choose } = upload;
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (stage.stage !== "reading") return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [stage.stage]);

  const pick = () => input.current?.click();
  const take = (f: File | null | undefined) => {
    if (f) void choose(f);
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDrag(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false);
    },
    onDrop: (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      setDrag(false);
      take(droppedFile(e));
    },
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      hidden
      data-testid="upload-input"
      onChange={(e) => {
        take(e.target.files?.[0]);
        e.target.value = ""; // choosing the same file again still reads it
      }}
    />
  );

  const chooseBtn = (label: string, quiet = false) => (
    <button type="button" className={quiet ? "btn btn--quiet upload-again" : "btn-file"} onClick={pick}>
      {label}
    </button>
  );

  return (
    <div className={`upload upload--${stage.stage} ${drag ? "is-drag" : ""}`} {...dropProps}>
      {fileInput}

      {stage.stage === "empty" && (
        <div className="upload-empty">
          <p className="upload-lede">Bring a score as MusicXML</p>
          <p className="upload-how">
            MuseScore, Finale and Sibelius all export it (File → Export → MusicXML). The site takes .musicxml, .xml or compressed
            .mxl files up to {prettySize(MAX_FILE_BYTES)}.
          </p>
          <div className="upload-actions">
            {chooseBtn("Choose a MusicXML file")}
            <span className="upload-drop-hint">or drop it here</span>
          </div>
        </div>
      )}

      {stage.stage === "reading" && (
        <div className="upload-reading">
          <p>
            <span className="clock">{Math.max(0, Math.floor((now - stage.started) / 1000))}&nbsp;s</span> Reading “{stage.name}”: finding
            its parts, movements and bars. A long score takes a little while.
          </p>
          {chooseBtn("Choose another file", true)}
        </div>
      )}

      {stage.stage === "failed" && (
        <div className="upload-failed">
          <p className="arrange-error" role="alert">
            {stage.message}
          </p>
          <div className="upload-actions">
            {chooseBtn("Choose another file")}
            <span className="upload-drop-hint">or drop one here</span>
          </div>
        </div>
      )}

      {stage.stage === "ready" && (
        <div className="upload-ready">
          <div className="upload-head">
            {stage.info.composer && <p className="upload-composer">{stage.info.composer}</p>}
            <p className="upload-title">{stage.info.title}</p>
            <p className="upload-parts">
              {stage.info.parts.length} {stage.info.parts.length === 1 ? "part" : "parts"}: {stage.info.parts.join(", ")}
            </p>
            {stage.info.notes.length > 0 && (
              <ul className="upload-notes">
                {stage.info.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <p className="upload-file">
              {stage.file.name} · {prettySize(stage.file.size)} {chooseBtn("Choose another file", true)}
            </p>
          </div>

          <fieldset className="upload-bars">
            <legend className="upload-bars-legend">Bars to arrange</legend>
            <div className="upload-bars-row">
              {stage.info.movements.length > 1 ? (
                <label className="ub-field ub-mvt">
                  <span className="ub-label">Movement</span>
                  <select
                    value={choice?.movement ?? stage.info.movements[0].index}
                    onChange={(e) => setChoice(defaultChoice(stage.info, Number(e.target.value)))}
                  >
                    {stage.info.movements.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.label} (bars {m.first}–{m.last})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="ub-field ub-mvt ub-static">
                  <span className="ub-label">Movement</span>
                  {stage.info.movements[0].label} (bars {stage.info.movements[0].first}–{stage.info.movements[0].last})
                </p>
              )}
              <label className="ub-field ub-num">
                <span className="ub-label">From bar</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={choice?.from ?? ""}
                  onChange={(e) => choice && setChoice({ ...choice, from: e.target.value })}
                  aria-invalid={!sel.ok && !!sel.message}
                  aria-describedby="ub-note"
                />
              </label>
              <label className="ub-field ub-num">
                <span className="ub-label">to bar</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={choice?.to ?? ""}
                  onChange={(e) => choice && setChoice({ ...choice, to: e.target.value })}
                  aria-invalid={!sel.ok && !!sel.message}
                  aria-describedby="ub-note"
                />
              </label>
            </div>
            {(() => {
              const m = stage.info.movements.find((x) => x.index === choice?.movement);
              return m?.note ? <p className="ub-mvt-note">{m.note}</p> : null;
            })()}
            <p id="ub-note" className={`ub-note ${!sel.ok && sel.message ? "is-bad" : ""}`} aria-live="polite">
              {sel.ok
                ? `${sel.end - sel.start + 1} ${sel.end - sel.start === 0 ? "bar" : "bars"} chosen; up to ${stage.info.maxBars} at a time.`
                : sel.message ?? ""}
            </p>
          </fieldset>
          <p className="upload-fine">
            Your score isn't part of this page's link, because nothing is stored: a link copied now opens with your band, not your
            score.
          </p>
        </div>
      )}
    </div>
  );
}
