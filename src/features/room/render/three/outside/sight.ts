// Does the eye see the window at all? `view.ts` asks the GPU, with an occlusion query on the window's quad, drawn after what stands before it.
// The case often fills the frame, and the city behind it would be drawn for nothing. The answer comes a frame or more late, so it only counts
// while the eye stands still: when the eye moves the city is drawn at once, and nothing pops. When a thing moves off the window the picture
// drawn last still fits the eye, and the next is drawn as soon as the answer comes.

/** The part of WebGL2 a query takes. */
export type QueryGL = Pick<WebGL2RenderingContext, 'createQuery' | 'beginQuery' | 'endQuery' | 'getQueryParameter' | 'ANY_SAMPLES_PASSED_CONSERVATIVE' | 'QUERY_RESULT' | 'QUERY_RESULT_AVAILABLE'>;

export class Sight {
  /** The window is hidden from the eye as it stands. */
  hidden = false;
  private query: WebGLQuery | null = null;
  /** The next draw of the quad may be asked about; it is being asked about; its answer has not come; that answer is about an eye that has moved. */
  private armed = false;
  private asking = false;
  private waiting = false;
  private old = false;

  /** Each frame, before anything is drawn: hears the answer if it has come. `moved`: the eye is not where it was last frame. */
  frame(gl: QueryGL, moved: boolean): void {
    if (moved) { this.hidden = false; this.old = this.waiting; }
    if (this.waiting && gl.getQueryParameter(this.query!, gl.QUERY_RESULT_AVAILABLE)) {
      this.waiting = false;
      if (!this.old) this.hidden = !gl.getQueryParameter(this.query!, gl.QUERY_RESULT);
      this.old = false;
    }
    this.armed = !this.waiting;
  }

  /** Just before the quad's draw. */
  begin(gl: QueryGL): void {
    if (!this.armed) return;
    this.armed = false;
    this.asking = true;
    gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, (this.query ??= gl.createQuery()));
  }

  /** Just after the quad's draw. */
  end(gl: QueryGL): void {
    if (!this.asking) return;
    this.asking = false;
    this.waiting = true;
    gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
  }
}
