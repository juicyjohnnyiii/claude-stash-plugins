(function () {
    'use strict';

    const { stash, getElementByXpath } = window.stash7dJx1qP;

    async function gqlFetch(query, variables) {
        const res = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables }),
        });
        return res.json();
    }

    function getSceneId(searchItem) {
        const link = searchItem.querySelector('a[href*="/scenes/"]');
        if (!link) return null;
        const match = link.getAttribute('href').match(/\/scenes\/(\d+)/);
        return match ? match[1] : null;
    }

    async function acceptAllTagsForItem(searchItem, onProgress) {
        let count = 0;
        while (true) {
            const createBtn = searchItem.querySelector(
                'div.col-lg-6 div.mt-2 span.tag-item.badge.badge-secondary button[title="Create"]'
            );
            if (!createBtn) break;
            createBtn.click();
            count++;
            if (onProgress) onProgress(count);
            await new Promise((r) => setTimeout(r, 700));
        }
        return count;
    }

    async function acceptAllTags(searchItem, button) {
        button.disabled = true;
        const originalText = button.textContent;
        const count = await acceptAllTagsForItem(searchItem, (n) => {
            button.textContent = `Accepting… (${n})`;
        });
        button.textContent = count > 0 ? `Accepted ${count} tag${count === 1 ? '' : 's'}` : 'No tags pending';
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 2500);
    }

    async function acceptAllTagsPageWide(button) {
        button.disabled = true;
        const originalText = button.textContent;
        const items = document.querySelectorAll('.search-item');
        let totalTags = 0;
        let itemsWithTags = 0;
        for (let i = 0; i < items.length; i++) {
            button.textContent = `Accepting… (item ${i + 1}/${items.length}, ${totalTags} tag${totalTags === 1 ? '' : 's'})`;
            const count = await acceptAllTagsForItem(items[i]);
            if (count > 0) itemsWithTags++;
            totalTags += count;
        }
        button.textContent = `Accepted ${totalTags} tag${totalTags === 1 ? '' : 's'} across ${itemsWithTags} scene${itemsWithTags === 1 ? '' : 's'}`;
        setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
        }, 4000);
    }

    async function deleteFromDisk(searchItem, button) {
        const sceneId = getSceneId(searchItem);
        if (!sceneId) {
            alert('Could not determine scene ID for this item.');
            return;
        }
        const titleNode = searchItem.querySelector('.TruncatedText, .scene-link');
        const title = titleNode ? titleNode.textContent.trim() : `scene ${sceneId}`;
        const confirmed = confirm(
            `Permanently delete "${title}" (scene ${sceneId}) from disk?\n\nThis removes the file and its Stash record. This cannot be undone.`
        );
        if (!confirmed) return;

        button.disabled = true;
        button.textContent = 'Deleting…';

        const res = await gqlFetch(
            `mutation ($ids: [ID!]!) {
                scenesDestroy(input: { ids: $ids, delete_file: true, delete_generated: true, destroy_file_entry: true })
            }`,
            { ids: [sceneId] }
        );

        if (res.errors || !res.data || !res.data.scenesDestroy) {
            button.textContent = 'Delete failed';
            button.disabled = false;
            console.error('ClaudeTaggerTools: scenesDestroy failed', res.errors);
            return;
        }

        searchItem.style.transition = 'opacity 0.3s';
        searchItem.style.opacity = '0.3';
        button.textContent = 'Deleted';
        setTimeout(() => {
            const removeBtn = Array.from(searchItem.querySelectorAll('button')).find(
                (b) => b.textContent.trim() === 'Remove'
            );
            if (removeBtn) removeBtn.click();
        }, 400);
    }

    function findAnchor(searchItem) {
        // Prefer the "Remove" button's container - but Stash doesn't always render
        // Remove (e.g. items flagged with a duration/fingerprint mismatch warning
        // sometimes omit it entirely), so fall back to "Scrape by fragment"'s
        // container, which has been present in every observed match state so far.
        const removeContainer = searchItem.querySelector('.tagger-remove');
        if (removeContainer) return removeContainer;

        const scrapeBtn = Array.from(searchItem.querySelectorAll('button')).find(
            (b) => b.textContent.trim().includes('Scrape by fragment')
        );
        return scrapeBtn ? scrapeBtn.parentElement : null;
    }

    function injectButtons(searchItem) {
        if (searchItem.querySelector('.claude-tagger-tools')) return;

        const anchor = findAnchor(searchItem);
        if (!anchor) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'mt-2 text-right claude-tagger-tools';
        wrapper.style.display = 'flex';
        wrapper.style.gap = '0.5rem';
        wrapper.style.justifyContent = 'flex-end';

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'btn btn-primary';
        acceptBtn.textContent = 'Accept All Tags';
        acceptBtn.addEventListener('click', () => acceptAllTags(searchItem, acceptBtn));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn btn-danger';
        deleteBtn.textContent = 'Delete from Disk';
        deleteBtn.addEventListener('click', () => deleteFromDisk(searchItem, deleteBtn));

        wrapper.appendChild(acceptBtn);
        wrapper.appendChild(deleteBtn);
        anchor.parentElement.insertBefore(wrapper, anchor);
    }

    const pageAcceptBtnId = 'claude-accept-all-tags-page';

    function injectPageButton() {
        if (document.getElementById(pageAcceptBtnId)) return;
        const scrapeAllBtn = getElementByXpath("//button[text()='Scrape All']");
        if (!scrapeAllBtn) return;

        const btn = document.createElement('button');
        btn.id = pageAcceptBtnId;
        btn.type = 'button';
        btn.className = 'btn btn-primary ml-3';
        btn.textContent = 'Accept All Tags (Page)';
        btn.title = 'Bulk-accept every pending tag on every scene currently shown on this page. Review matches as you go - this does not check whether a scene is actually correctly matched first.';
        btn.addEventListener('click', () => acceptAllTagsPageWide(btn));

        scrapeAllBtn.parentElement.appendChild(btn);
    }

    stash.addEventListener('tagger:searchitem', function (evt) {
        try {
            injectButtons(evt.detail);
        } catch (e) {
            console.error('ClaudeTaggerTools: injectButtons via event failed', e);
        }
    });

    stash.addEventListener('tagger:mutations:header', function () {
        try {
            injectPageButton();
        } catch (e) {
            console.error('ClaudeTaggerTools: injectPageButton via event failed', e);
        }
    });

    // Safety net: the Tagger page's shared event-dispatch chain has proven fragile
    // (a bug in another plugin/library can throw mid-dispatch and starve every
    // listener registered after it for that specific item - discovered 2026-08-22,
    // see reference_claude-stash-plugin-base memory). Don't depend solely on events
    // firing - periodically sweep for anything missing our buttons and inject
    // directly, independent of whatever else is happening.
    setInterval(() => {
        document.querySelectorAll('.search-item').forEach((searchItem) => {
            try {
                injectButtons(searchItem);
            } catch (e) {
                console.error('ClaudeTaggerTools: injectButtons via sweep failed', e);
            }
        });
        try {
            injectPageButton();
        } catch (e) {
            console.error('ClaudeTaggerTools: injectPageButton via sweep failed', e);
        }
    }, 1500);
})();
