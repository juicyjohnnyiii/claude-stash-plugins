(function () {
    'use strict';

    const {
        stash,
        Stash,
        waitForElementId,
        waitForElementClass,
        waitForElementByXpath,
        getElementByXpath,
        reloadImg,
    } = window.stash7dJx1qP;

    document.body.appendChild(document.createElement('style')).textContent = `
    .cropper-view-box img { transition: none; }
    .detail-header-image { flex-direction: column; }
    `;

    let cropping = false;
    let cropper = null;

    /**
     * Find whichever performer image is CURRENTLY VISIBLE - handles both the
     * plain stock layout (no SecondaryPerformerImage plugin) and all 3 of
     * SecondaryPerformerImage's display modes, which always wrap the image in
     * a .primary-image/.secondary-image pair with an "active"/"inactive"
     * class regardless of mode. Fixes two real bugs from the original plugin:
     * 1. It always grabbed the FIRST img.performer in document order (always
     *    the primary one, even while the secondary image was the one shown),
     *    so the crop overlay/button ended up positioned against the wrong
     *    (often hidden/differently-laid-out) element - visually appearing
     *    shifted right/down and reacting oddly.
     * 2. It always saved back to the performer's "image" field, which would
     *    silently overwrite the PRIMARY image even if you were cropping what
     *    you thought was the secondary one.
     */
    function getActiveImage() {
        const activeImg = document.querySelector(
            '.primary-image.active img.performer, .secondary-image.active img.performer'
        );
        if (activeImg) {
            return { img: activeImg, isSecondary: !!activeImg.closest('.secondary-image') };
        }
        // No SecondaryPerformerImage wrapper present - stock layout fallback.
        const img = getElementByXpath("//div[contains(@class, 'detail-header-image')]//img[@class='performer']");
        return { img: img, isSecondary: false };
    }

    function buildCropUI() {
        const cropBtnContainerId = "crop-btn-container";
        const existing = document.getElementById(cropBtnContainerId);
        if (existing) existing.remove();

        const performerId = window.location.pathname.replace('/performers/', '').split('/')[0];
        const active = getActiveImage();
        const image = active.img;
        const isSecondary = active.isSecondary;

        image.parentElement.addEventListener('click', (evt) => {
            if (cropping) {
                evt.preventDefault();
                evt.stopPropagation();
            }
        });

        const cropBtnContainer = document.createElement('div');
        cropBtnContainer.setAttribute("id", cropBtnContainerId);
        // Insert into the actual .detail-header-image ancestor (found via
        // closest(), not a hardcoded parentElement.parentElement) so it lays
        // out correctly whether or not SecondaryPerformerImage's extra
        // .perf-images/.primary-image/.secondary-image wrapper divs are present.
        const headerImage = image.closest('.detail-header-image') || image.parentElement.parentElement;
        headerImage.appendChild(cropBtnContainer);

        const cropInfo = document.createElement('p');

        const cropStart = document.createElement('button');
        cropStart.setAttribute("id", "crop-start");
        cropStart.classList.add('btn', 'btn-primary');
        cropStart.innerText = isSecondary ? 'Crop Secondary Image' : 'Crop Image';
        cropStart.addEventListener('click', evt => {
            cropping = true;
            cropStart.style.display = 'none';
            cropCancel.style.display = 'inline-block';

            cropper = new Cropper(image, {
                viewMode: 1,
                initialAspectRatio: 2 / 3,
                movable: false,
                rotatable: false,
                scalable: false,
                zoomable: false,
                zoomOnTouch: false,
                zoomOnWheel: false,
                ready() {
                    cropAccept.style.display = 'inline-block';
                },
                crop(e) {
                    cropInfo.innerText = `X: ${Math.round(e.detail.x)}, Y: ${Math.round(e.detail.y)}, Width: ${Math.round(e.detail.width)}px, Height: ${Math.round(e.detail.height)}px`;
                }
            });
        });
        cropBtnContainer.appendChild(cropStart);

        const cropAccept = document.createElement('button');
        cropAccept.setAttribute("id", "crop-accept");
        cropAccept.classList.add('btn', 'btn-success', 'mr-2');
        cropAccept.innerText = 'OK';
        cropAccept.addEventListener('click', async evt => {
            cropping = false;
            cropStart.style.display = 'inline-block';
            cropAccept.style.display = 'none';
            cropCancel.style.display = 'none';
            const cropInfoText = cropInfo.innerText;
            cropInfo.innerText = '';

            const dataUrl = cropper.getCroppedCanvas().toDataURL();
            // Write to the correct field depending on which image was active
            // when cropping started - "image" for primary, the alt_image
            // custom field (same one SecondaryPerformerImage reads) otherwise.
            const input = isSecondary
                ? { id: performerId, custom_fields: { partial: { alt_image: dataUrl } } }
                : { id: performerId, image: dataUrl };

            const reqData = {
                "operationName": "PerformerUpdate",
                "variables": { "input": input },
                "query": `mutation PerformerUpdate($input: PerformerUpdateInput!) {
                    performerUpdate(input: $input) {
                      id
                    }
                  }`
            };
            const resp = await stash.callGQL(reqData);
            if (resp?.data?.performerUpdate?.id) {
                reloadImg(image.src);
                cropper.destroy();
            }
            else if (resp?.errors[0]?.message) {
                cropping = true;
                cropStart.style.display = 'none';
                cropAccept.style.display = 'inline-block';
                cropCancel.style.display = 'inline-block';
                cropInfo.innerText = cropInfoText;
                alert(resp.errors[0].message);
            }
        });
        cropBtnContainer.appendChild(cropAccept);

        const cropCancel = document.createElement('button');
        cropCancel.setAttribute("id", "crop-accept");
        cropCancel.classList.add('btn', 'btn-danger');
        cropCancel.innerText = 'Cancel';
        cropCancel.addEventListener('click', evt => {
            cropping = false;
            cropStart.style.display = 'inline-block';
            cropAccept.style.display = 'none';
            cropCancel.style.display = 'none';
            cropInfo.innerText = '';

            cropper.destroy();
        });
        cropBtnContainer.appendChild(cropCancel);
        cropAccept.style.display = 'none';
        cropCancel.style.display = 'none';

        cropBtnContainer.appendChild(cropInfo);
    }

    stash.addEventListener('page:performer:any', function () {
        waitForElementClass('detail-container', function () {
            if (!document.getElementById('crop-btn-container')) {
                buildCropUI();
            }

            // Re-attach the crop UI to whichever image becomes active whenever
            // SecondaryPerformerImage's flip button (mode 2) is clicked, so the
            // button/overlay always tracks the currently-visible image instead
            // of staying pinned to whichever one was active on page load.
            const flipBtn = document.querySelector('.flip');
            if (flipBtn && !flipBtn.dataset.claudeCropperBound) {
                flipBtn.dataset.claudeCropperBound = '1';
                flipBtn.addEventListener('click', function () {
                    // Wait a tick for the active/inactive classes to flip first.
                    setTimeout(buildCropUI, 50);
                });
            }
        });
    });
})();
