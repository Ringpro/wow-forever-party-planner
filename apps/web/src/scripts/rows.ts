// Progressive enhancement for DayRow: every form inside a row saves in the background, then the
// row is swapped for the fresh one from the server's response, so the page doesn't jump.
// Without JavaScript the forms still work as normal posts.

async function save(row: HTMLElement, form: HTMLFormElement, data: FormData) {
  row.classList.add("saving");
  try {
    // Not form.action: a field named "action" inside the form shadows that property.
    const url = form.getAttribute("action") || location.pathname + location.search;
    const res = await fetch(url, { method: "POST", body: data });
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
  }
  // Only one time editor open at a time.
  for (const details of row.querySelectorAll("details")) {
    details.addEventListener("toggle", () => {
      if (!(details instanceof HTMLDetailsElement) || !details.open) return;
      for (const other of document.querySelectorAll("details.slot[open]")) {
        if (other !== details && other instanceof HTMLDetailsElement) other.open = false;
      }
    });
  }
}

for (const row of document.querySelectorAll("[data-row]")) {
  if (row instanceof HTMLElement) bind(row);
}
