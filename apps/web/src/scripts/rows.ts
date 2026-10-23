// Progressive enhancement for DayRow forms: save in the background and swap in the fresh row
// from the server's response, so the page doesn't jump. Without JavaScript the forms still work.

async function save(form: HTMLFormElement, data: FormData) {
  form.classList.add("saving");
  try {
    const res = await fetch(form.action, { method: "POST", body: data });
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const flash = document.getElementById("flash");
    const freshFlash = doc.getElementById("flash");
    if (flash && freshFlash) flash.replaceWith(freshFlash);

    const fresh = doc.getElementById(form.id);
    if (!fresh) return location.reload();
    form.replaceWith(fresh);
    bind(fresh as HTMLFormElement);
    if (!freshFlash?.textContent?.trim()) {
      fresh.classList.add("just-saved");
      setTimeout(() => fresh.classList.remove("just-saved"), 1500);
    }
  } catch {
    // Network trouble: fall back to a normal form post.
    form.submit();
  }
}

function bind(form: HTMLFormElement) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save(form, new FormData(form, event.submitter));
  });
  // Changing a time on a day you're playing saves right away; otherwise it waits for Yes/Maybe.
  for (const select of form.querySelectorAll("select")) {
    select.addEventListener("change", () => {
      const status = form.dataset.status;
      if (status !== "yes" && status !== "maybe") return;
      const data = new FormData(form);
      data.set("status", status);
      save(form, data);
    });
  }
}

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-row]")) bind(form);
