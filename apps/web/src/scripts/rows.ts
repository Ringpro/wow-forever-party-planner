// Progressive enhancement for DayRow: every form inside a row saves in the background, then the
// row is swapped for the fresh one from the server's response, so the page doesn't jump.
// Without JavaScript the forms still work as normal posts.

async function save(row: HTMLElement, form: HTMLFormElement, data: FormData) {
  row.classList.add("saving");
  try {
    const res = await fetch(form.action, { method: "POST", body: data });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const flash = document.getElementById("flash");
    const freshFlash = doc.getElementById("flash");
    if (flash && freshFlash) flash.replaceWith(freshFlash);

    const fresh = doc.getElementById(row.id);
    if (!fresh) return location.reload();
    row.replaceWith(fresh);
    bind(fresh);
    if (!freshFlash?.textContent?.trim()) {
      fresh.classList.add("just-saved");
      setTimeout(() => fresh.classList.remove("just-saved"), 1500);
    }
  } catch {
    // Network trouble: fall back to a normal form post.
    form.submit();
  }
}

function bind(row: HTMLElement) {
  for (const form of row.querySelectorAll("form")) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save(row, form, new FormData(form, event.submitter));
    });
    // Changing a time on a slot you're playing saves right away; otherwise it waits for Yes/Maybe.
    for (const select of form.querySelectorAll("select")) {
      select.addEventListener("change", () => {
        const status = form.dataset.status;
        if (status !== "yes" && status !== "maybe") return;
        const data = new FormData(form);
        data.set("status", status);
        save(row, form, data);
      });
    }
  }
}

for (const row of document.querySelectorAll("[data-row]")) {
  if (row instanceof HTMLElement) bind(row);
}
