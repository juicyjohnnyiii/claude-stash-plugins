(function () {
  "use strict";

  const PLUGIN_ID = "performerGallerySync";
  const TAG_NAME = "[Performer Gallery Sync]";
  const BUTTON_ID = "pgs-sync-button";

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

  async function ensureTagAndFetchId(performerId) {
    const findTagQuery = `
      mutation TagCreate($name: String!) {
        tagCreate(input: { name: $name }) { id }
      }
    `;
    // findTag with create semantics isn't directly exposed to the frontend,
    // so look it up first and only create if missing.
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
      const createData = await graphqlRequest(findTagQuery, { name: TAG_NAME });
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
    return tagId;
  }

  async function runSync(performerId, performerName, button) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Starting...";

    try {
      await ensureTagAndFetchId(performerId);

      const runQuery = `
        mutation RunPluginTask($plugin_id: ID!, $task_name: String!, $description: String, $args: [PluginArgInput!]) {
          runPluginTask(plugin_id: $plugin_id, task_name: $task_name, description: $description, args: $args)
        }
      `;
      const jobId = await graphqlRequest(runQuery, {
        plugin_id: PLUGIN_ID,
        task_name: "Process Performers",
        description: `Process Performers - ${performerName}`,
        args: [{ key: "performer", value: { str: performerId } }],
      });

      button.textContent = `Queued (job ${jobId?.runPluginTask ?? "?"})`;
    } catch (e) {
      console.error("[PerformerGallerySync] Failed to queue sync:", e);
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
    button.textContent = "Sync Gallery";
    button.title = "Tag this performer [Performer Gallery Sync] (if not already) and run it now";

    button.addEventListener("click", () => {
      const performerName = getPerformerNameFromPage();
      runSync(performerId, performerName, button);
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
  console.log("[PerformerGallerySync] Per-performer sync button loaded");
})();
