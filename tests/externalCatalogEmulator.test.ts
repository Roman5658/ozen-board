import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deleteApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment,
    type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import { runExternalListingImport } from "../functions/src/imports/runExternalListingImport";
import { FirestoreExternalListingsRepository } from "../functions/src/imports/firestoreExternalListingsRepository";
import { createExternalListingFixtureAdapter, loadExternalListingFixtureRows } from "./externalListingFixtureAdapter";
import { loadActiveExternalCatalogWindow } from "../src/data/externalListings";
import { loadActiveExternalCatalogPage } from "../src/data/externalListings";
import type { CatalogFilterState } from "../src/utils/catalogFilters";

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT_ID = "demo-ozen-board-stage-61";

test("Firestore emulator verifies fixture import, public catalog reads, and client write protections", {
    skip: !EMULATOR_HOST,
}, async () => {
    const [host, rawPort] = (EMULATOR_HOST ?? "127.0.0.1:8088").split(":");
    const port = Number(rawPort);
    const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
    let environment: RulesTestEnvironment | undefined;
    let adminApp: ReturnType<typeof initializeAdminApp> | undefined;

    try {
        environment = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: { host, port, rules },
        });
        await environment.clearFirestore();

        adminApp = initializeAdminApp({ projectId: PROJECT_ID }, `stage61-${Date.now()}`);
        const adminDb = getAdminFirestore(adminApp);
        const repository = new FirestoreExternalListingsRepository(adminDb);
        const initialRows = await loadExternalListingFixtureRows();
        const firstImport = await runExternalListingImport(
            createExternalListingFixtureAdapter(initialRows),
            repository,
            { createRunId: () => "fixture-full-1", pageSize: 5, now: Date.now },
        );

        assert.equal(firstImport.status, "complete");
        assert.equal(firstImport.created, 20);
        assert.equal(firstImport.duplicates, 1);
        assert.equal(firstImport.skipped, 1);

        await environment.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, "ads", "ordinary-user-ad"), {
                userId: "owner-uid",
                uid: "owner-uid",
                title: "Synthetic user listing",
                description: "Only synthetic emulator data",
                category: "sell",
                city: "Warszawa",
                voivodeship: "mazowieckie",
                price: "10",
                priceType: "paid",
                status: "active",
                createdAt: Date.now(),
            });
            await setDoc(doc(firestore, "users", "owner@example.test"), {
                id: "owner@example.test",
                uid: "owner-uid",
                email: "owner@example.test",
                nickname: "SyntheticOwner",
                status: "active",
                karma: 0,
                createdAt: Date.now(),
            });
            await setDoc(doc(firestore, "externalAds", "manual-hidden"), {
                isExternal: true,
                sourceId: "synthetic-fixture",
                sourceListingId: "hidden",
                originalUrl: "https://vendor.example/listings/hidden",
                title: "Synthetic hidden record",
                offerType: "unknown",
                importedAt: Date.now(),
                lastSeenAt: Date.now(),
                status: "hidden",
            });
            await setDoc(doc(firestore, "externalAds", "manual-stale"), {
                isExternal: true,
                sourceId: "synthetic-fixture",
                sourceListingId: "stale",
                originalUrl: "https://vendor.example/listings/stale",
                title: "Synthetic stale record",
                offerType: "unknown",
                importedAt: Date.now(),
                lastSeenAt: Date.now(),
                status: "stale",
            });
        });

        const anonymous = environment.unauthenticatedContext().firestore();
        const activeWindow = await loadActiveExternalCatalogWindow(anonymous);
        assert.equal(activeWindow.mayHaveMore, false);
        assert.equal(activeWindow.listings.length, 19);
        assert.equal(activeWindow.listings.some((listing) => listing.sourceListingId === "fixture-001"), true);
        assert.equal(activeWindow.listings.some((listing) => listing.offerType === "unknown"), true);

        const filters: CatalogFilterState = {
            category: "all",
            catalogCategory: "all",
            catalogSubcategory: "",
            offerType: "all",
            voivodeship: "all",
            city: "",
            query: "",
            minPrice: "",
            maxPrice: "",
            sort: "newest",
        };
        const externalPage1 = await loadActiveExternalCatalogPage(anonymous, filters, null, 8);
        const externalPage2 = await loadActiveExternalCatalogPage(anonymous, filters, externalPage1.cursor, 8);
        assert.equal(externalPage1.listings.length, 8);
        assert.equal(externalPage1.hasMore, true);
        assert.equal(externalPage2.listings.length, 8);
        assert.equal(externalPage2.listings.some((listing) => externalPage1.listings.some((previous) => previous.id === listing.id)), false);

        const priceResults = await loadActiveExternalCatalogPage(anonymous, {
            ...filters,
            minPrice: "20",
            maxPrice: "100",
            sort: "priceAsc",
        });
        assert.deepEqual(priceResults.listings.map((listing) => listing.priceAmount), [25, 40, 65, 75, 99]);

        const duplicateQuery = await adminDb.collection("externalAds")
            .where("sourceListingId", "==", "fixture-001")
            .get();
        assert.equal(duplicateQuery.size, 1);

        const partialRows = initialRows.filter((row) => row.sourceListingId !== "fixture-stale");
        const partialImport = await runExternalListingImport(
            createExternalListingFixtureAdapter(partialRows),
            repository,
            { createRunId: () => "fixture-partial", pageSize: 5, maxPages: 1, now: () => Date.now() + 1_000 },
        );
        assert.equal(partialImport.status, "partial");
        assert.equal(partialImport.stale, 0);
        assert.equal((await adminDb.collection("externalAds").where("sourceListingId", "==", "fixture-stale").get()).docs[0].get("status"), "active");

        const updatedRows = initialRows
            .filter((row) => row.sourceListingId !== "fixture-stale")
            .map((row) => row.sourceListingId === "fixture-001" ? { ...row, priceAmount: 475 } : row);
        const secondImport = await runExternalListingImport(
            createExternalListingFixtureAdapter(updatedRows),
            repository,
            { createRunId: () => "fixture-full-2", pageSize: 7, now: () => Date.now() + 2_000 },
        );
        assert.equal(secondImport.status, "complete");
        assert.equal(secondImport.stale, 1);
        assert.equal((await adminDb.collection("externalAds").where("sourceListingId", "==", "fixture-stale").get()).docs[0].get("status"), "stale");
        assert.equal((await adminDb.collection("externalAds").where("sourceListingId", "==", "fixture-001").get()).docs[0].get("priceAmount"), 475);

        const duplicateUrlRow = {
            ...initialRows.find((row) => row.sourceListingId === "fixture-001")!,
            sourceListingId: "fixture-001-url-duplicate",
            originalUrl: "https://VENDOR.example:443/listings/fixture-001#details",
        };
        const duplicateUrlAdapter = createExternalListingFixtureAdapter([duplicateUrlRow]);
        const duplicateUrlImport = await runExternalListingImport(
            { ...duplicateUrlAdapter, providesCompleteSnapshot: false },
            repository,
            { createRunId: () => "fixture-url-duplicate", pageSize: 5, now: () => Date.now() + 3_000 },
        );
        assert.equal(duplicateUrlImport.status, "complete");
        assert.equal(duplicateUrlImport.created, 0);
        assert.equal(duplicateUrlImport.duplicates, 1);

        const currentActiveIds = new Set((await loadActiveExternalCatalogWindow(anonymous)).listings.map((listing) => listing.sourceListingId));
        assert.equal(currentActiveIds.has("fixture-stale"), false);

        const importedFixtureDocId = duplicateQuery.docs[0].id;
        assert.equal((await getDoc(doc(anonymous, "externalAds", importedFixtureDocId))).exists(), true);
        await assertFails(getDoc(doc(anonymous, "externalAds", "manual-hidden")));
        await assertFails(getDoc(doc(anonymous, "externalAds", "manual-stale")));
        await assertFails(setDoc(doc(anonymous, "externalAds", "client-created"), { status: "active" }));
        await assertFails(updateDoc(doc(anonymous, "externalAds", importedFixtureDocId), { title: "client overwrite" }));
        await assertFails(deleteDoc(doc(anonymous, "externalAds", importedFixtureDocId)));
        await assertFails(getDoc(doc(anonymous, "externalImportRuns", "fixture-full-1")));
        await assertFails(setDoc(doc(anonymous, "externalImportRuns", "client-run"), { status: "complete" }));
        const adminContext = environment.authenticatedContext("admin-uid", { email: "ozenenesis56@gmail.com" }).firestore();
        await assertSucceeds(getDoc(doc(adminContext, "externalImportRuns", "fixture-full-1")));
        await assertFails(updateDoc(doc(adminContext, "externalImportRuns", "fixture-full-1"), { status: "complete" }));

        await assertSucceeds(getDoc(doc(anonymous, "ads", "ordinary-user-ad")));
        const ownerContext = environment.authenticatedContext("owner-uid", { email: "owner@example.test" }).firestore();
        await assertFails(updateDoc(doc(ownerContext, "ads", "ordinary-user-ad"), { userId: "attacker-uid" }));
        await assertSucceeds(updateDoc(doc(ownerContext, "ads", "ordinary-user-ad"), { title: "Owner update remains available" }));
        await assertFails(updateDoc(doc(ownerContext, "users", "owner@example.test"), { role: "admin" }));

        const activeQuery = query(
            collection(anonymous, "externalAds"),
            where("status", "==", "active"),
            orderBy("lastSeenAt", "desc"),
        );
        const activeQuerySnapshot = await assertSucceeds(getDocs(activeQuery));
        assert.equal(activeQuerySnapshot.docs.every((snapshot) => snapshot.get("status") === "active"), true);
    } finally {
        await environment?.cleanup();
        if (adminApp) await deleteApp(adminApp);
    }
});
