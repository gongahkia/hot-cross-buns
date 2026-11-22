export const samples = [
  ["Give me a short plan for a slower Sunday.", `## A little room to breathe
Start with coffee and a walk. Leave the afternoon open.

- Pick up bread from the bakery
- Read a chapter somewhere sunny
- Cook something simple with what’s already in the kitchen

> You only need one thing on the calendar.

| Time | A loose plan |
| --- | --- |
| Morning | Coffee, then a walk |
| Afternoon | Reading, or nothing at all |
| Evening | A quiet dinner |

Use **bold for emphasis**, *italics for a softer note*, and \`inline code\` for technical details.`],
  ["Can you turn that into a small HTML card?", `Here’s a printable note for the fridge.

\`\`\`html
<style>
  .note { max-width: 480px; margin: auto; padding: 32px; background: #f5f4ef; border-radius: 3px; }
  .note p { margin: 0; color: #78756d; font-size: 13px; }
  .note h2 { margin: 12px 0; font: 34px/1.15 Georgia, serif; font-weight: normal; }
  .note ul { padding-left: 18px; line-height: 2; }
</style>
<section class="note">
  <p>SUNDAY, AT YOUR OWN PACE</p>
  <h2>Leave a little<br>space in the day.</h2>
  <ul><li>A walk with no destination</li><li>Something good to read</li><li>Dinner at home</li></ul>
</section>
\`\`\``],
  ["Show me an SVG of the day’s rhythm.", `A loose sketch of energy across the day.

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 180" role="img" aria-label="A gentle arc from morning to evening">
  <path d="M30 130H530" stroke="#e3e1dc"/>
  <path d="M30 120C110 120 120 40 230 50S390 125 530 85" fill="none" stroke="#888f7b" stroke-width="3"/>
  <g fill="#78756d" font-family="system-ui" font-size="12"><text x="30" y="158">Morning</text><text x="235" y="158">Afternoon</text><text x="480" y="158">Evening</text></g>
  <circle cx="230" cy="50" r="5" fill="#888f7b"/>
</svg>
\`\`\``],
  ["How does a message move through the app?", `The browser sends your message to the local host, which passes it to the model and returns the response.

\`\`\`mermaid
flowchart LR
  A[Your message] --> B[Local host]
  B --> C[Model]
  C --> D[Response]
  D --> E[Rendered output]
\`\`\`

A sequence diagram shows the same exchange over time.

\`\`\`mermaid
sequenceDiagram
  participant You
  participant Host as Local host
  participant Model
  You->>Host: Send message
  Host->>Model: Request response
  Model-->>Host: Response
  Host-->>You: Render output
\`\`\``],
  ["And an animated GIF?", `A small breathing exercise. Follow the circle for a moment.

![A circle expanding and settling in a gentle loop](/preview.gif)`],
  ["What about a normal code response?", `Code stays readable and selectable.

\`\`\`js
const sunday = ["walk", "read", "cook"];

for (const activity of sunday) {
  console.log(activity);
}
\`\`\`

You can also include [a reference link](https://developer.mozilla.org/en-US/docs/Web/JavaScript).`],
  ["Can we include a little math?", String.raw`Inline math fits into the sentence, like $E = mc^2$ or \(a^2 + b^2 = c^2\).

For the full expression, give it a line of its own.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

\[
\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
\]`],
  ["Make me a small interactive selector.", `Choose a pace and use the buttons to move through the plan.

\`\`\`html
<style>
  .planner { max-width: 460px; margin: auto; padding: 12px; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  #step { margin: 24px 0; font: 28px Georgia, serif; }
</style>
<section class="planner">
  <label for="pace">Your pace</label>
  <select id="pace"><option>Slow</option><option>Very slow</option><option>No plans</option></select>
  <p id="step" aria-live="polite">Coffee, then a walk.</p>
  <div class="controls"><button id="previous">Previous</button><button id="next">Next</button><span id="position">1 / 3</span></div>
</section>
<script>
  const plans = ["Coffee, then a walk.", "A chapter in the sun.", "Something simple for dinner."];
  let index = 0;
  function show() {
    document.getElementById("step").textContent = document.getElementById("pace").value === "No plans" ? "Leave the day open." : plans[index];
    document.getElementById("position").textContent = (index + 1) + " / 3";
  }
  document.getElementById("next").onclick = () => { index = (index + 1) % plans.length; show(); };
  document.getElementById("previous").onclick = () => { index = (index + plans.length - 1) % plans.length; show(); };
  document.getElementById("pace").onchange = show;
</script>
\`\`\``],
  ["Can the SVG move as well?", `A gentle loop in the same muted palette.

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 160" role="img" aria-label="A softly breathing circle">
  <circle cx="280" cy="80" r="26" fill="currentColor">
    <animate attributeName="r" values="26;38;26" dur="5s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values=".6;1;.6" dur="5s" repeatCount="indefinite"/>
  </circle>
</svg>
\`\`\``],
];
