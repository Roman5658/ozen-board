import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FilterDisclosure from "../src/components/FilterDisclosure";
import PromotionCard from "../src/components/PromotionCard";
import { getAdsWithinRadius } from "../src/utils/nearbyFilters";

test("filter panel starts collapsed and preserves its active filter summary", () => {
    const html = renderToStaticMarkup(createElement(
        FilterDisclosure,
        {
            title: "Filters",
            resetLabel: "Reset",
            activeLabels: ["Kraków", "Category: electronics"],
            onReset: () => undefined,
        },
        createElement("input", { name: "search" }),
    ));

    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /class="filter-disclosure__count" aria-label="2">2/);
    assert.match(html, /Kraków/);
    assert.match(html, /Category: electronics/);
    assert.match(html, />Reset<\/button>/);
    assert.doesNotMatch(html, /name="search"/);
});

test("filter panel does not show reset when there are no active filters", () => {
    const html = renderToStaticMarkup(createElement(FilterDisclosure, {
        title: "Filters",
        resetLabel: "Reset",
        activeLabels: [],
        onReset: () => undefined,
    }, createElement("span", null, "Filter controls")));

    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /filter-disclosure__reset/);
    assert.doesNotMatch(html, /Filter controls/);
});

test("promotion option is a full-card radio and keeps the chosen state explicit", () => {
    const html = renderToStaticMarkup(createElement(PromotionCard, {
        name: "ad-promotion",
        title: "TOP 3",
        price: "14.99 PLN",
        description: "Visible for 10 days",
        checked: false,
        onSelect: () => undefined,
    }));

    assert.match(html, /^<label class="promotion-card">/);
    assert.match(html, /type="radio" name="ad-promotion"/);
    assert.doesNotMatch(html, /checked=""/);
    assert.match(html, /TOP 3/);
    assert.match(html, /14\.99 PLN/);
    assert.match(html, /Visible for 10 days/);
});

test("nearby radius filtering rejects missing or invalid geo data and honors the radius", () => {
    const ads = [
        { id: "close", location: { lat: 52.2297, lng: 21.0122 } },
        { id: "far", location: { lat: 50.0647, lng: 19.945 } },
        { id: "missing", location: undefined },
        { id: "invalid", location: { lat: 100, lng: 0 } },
    ];

    const matches = getAdsWithinRadius(ads, { lat: 52.2297, lng: 21.0122 }, 10);
    assert.deepEqual(matches.map((ad) => ad.id), ["close"]);
    assert.equal(matches[0].distance, 0);
    assert.deepEqual(getAdsWithinRadius(ads, { lat: 0, lng: 0 }, Number.POSITIVE_INFINITY), []);
});
