(function () {
  "use strict";

  const PLUGIN_ID = "porngals4";
  const TAG_NAME = "[Performer Gallery Sync]";
  const BUTTON_ID = "pg4-scrape-button";

  function getGraphQLUrl() {
    const baseEl = document.querySelector("base");
    const baseURL = baseEl ? baseEl.getAttribute("href") : "/";
    return `${baseURL}graphql`;
  }

  async function graphqlRequest(query, variables = {}) {
    const response = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const result = await response.json();
    if (result.errors && result.errors.length > 0) {
      throw new Error(result.errors[0].message);
    }
    return result.data;
  }

  function getPerformerIdFromUrl() {
    const match = window.location.pathname.match(/\/performers\/(\d+)/);
    return match ? match[1] : null;
  }

  function getPerformerNameFromPage() {
    const nameSpan = document.querySelector(".performer-name");
    if (nameSpan) return nameSpan.textContent?.trim() || "Unknown Performer";
    return document.title.trim();
  }

  async function ensureTag(performerId) {
    const searchQuery = `
      query FindTags($name: String!) {
        findTags(tag_filter: { name: { value: $name, modifier: EQUALS } }) {
          tags { id }
        }
      }
    `;
    const searchData = await graphqlRequest(searchQuery, { name: TAG_NAME });
    let tagId = searchData?.findTags?.tags?.[0]?.id;
    if (!tagId) {
      const createQuery = `
        mutation TagCreate($name: String!) {
          tagCreate(input: { name: $name }) { id }
        }
      `;
      const createData = await graphqlRequest(createQuery, { name: TAG_NAME });
      tagId = createData?.tagCreate?.id;
    }

    const performerQuery = `
      query FindPerformer($id: ID!) {
        findPerformer(id: $id) { id tags { id } }
      }
    `;
    const perfData = await graphqlRequest(performerQuery, { id: performerId });
    const hasTag = perfData?.findPerformer?.tags?.some((t) => t.id === tagId);
    if (!hasTag) {
      const updateQuery = `
        mutation PerformerUpdate($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) { id }
        }
      `;
      const existingTagIds = (perfData?.findPerformer?.tags || []).map((t) => t.id);
      await graphqlRequest(updateQuery, {
        input: { id: performerId, tag_ids: [...existingTagIds, tagId] },
      });
    }
  }

  async function runScrape(performerId, performerName, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Starting...";

    try {
      await ensureTag(performerId);

      const runQuery = `
        mutation RunPluginTask($plugin_id: ID!, $description: String, $args: [PluginArgInput!]) {
          runPluginTask(plugin_id: $plugin_id, description: $description, args: $args)
        }
      `;
      // porngals4 has no yml-defined tasks matching this mode, so no
      // task_name is passed - the plugin dispatches purely off args, same
      // as the JS calls this fork's own performer-search plugin already
      // makes into other plugins via runPluginOperation-style raw args.
      const jobId = await graphqlRequest(runQuery, {
        plugin_id: PLUGIN_ID,
        description: `PornGals4 Scrape - ${performerName}`,
        args: [
          { key: "mode", value: { str: "performer" } },
          { key: "performer", value: { str: performerId } },
        ],
      });

      button.textContent = `Queued (job ${jobId?.runPluginTask ?? "?"})`;
    } catch (e) {
      console.error("[PornGals4GallerySync] Failed to queue scrape:", e);
      button.textContent = "Failed - see console";
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalText;
      }, 3000);
    }
  }

  function addButton() {
    const performerId = getPerformerIdFromUrl();
    if (!performerId) return;
    if (document.getElementById(BUTTON_ID)) return;

    const buttonContainer =
      document.querySelector(".detail-header-buttons") ||
      document.querySelector('[class*="detail"] [class*="button"]')?.parentElement ||
      document.querySelector(".performer-head");

    if (!buttonContainer) {
      setTimeout(addButton, 500);
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "btn btn-secondary";
    button.style.marginLeft = "8px";
    button.textContent = "Scrape PornGals4";
    button.title = "Tag this performer [Performer Gallery Sync] (if not already) and scrape porngals4.com now";

    button.addEventListener("click", () => {
      const performerName = getPerformerNameFromPage();
      runScrape(performerId, performerName, button);
    });

    buttonContainer.appendChild(button);
  }

  function init() {
    PluginApi.Event.addEventListener("stash:location", () => {
      setTimeout(addButton, 100);
    });
    setTimeout(addButton, 100);
  }

  init();
  console.log("[PornGals4GallerySync] Per-performer scrape button loaded");
})();
