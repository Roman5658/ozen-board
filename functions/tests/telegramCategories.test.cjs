const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadTelegramListingsConfig,
  parseTelegramAdMessage,
  evaluateTelegramAdMessage,
} = require("../lib/imports/telegramListingsAdapter.js");

const chatId = "-1003976934887";
const senderId = 8519508488;

function makeChatSource() {
  const env = {
    TELEGRAM_LISTINGS_IMPORT_ENABLED: "true",
    TELEGRAM_LISTINGS_AUTO_PUBLISH_ENABLED: "true",
    TELEGRAM_LISTINGS_CHATS_JSON: JSON.stringify({
      [chatId]: {
        displayName: "@xoven_test_listings",
        publicUsername: "xoven_test_listings",
        chatType: "supergroup",
        allowedSenderIds: [String(senderId)],
        rightsReference: "https://t.me/xoven_test_listings",
        rightsReviewedAt: Date.now(),
        permissionConfirmed: true,
        rightsFields: [
          "title",
          "originalUrl",
          "description",
          "price",
          "category",
          "publishedAt",
          "location",
          "contact",
          "images",
        ],
        autoPublish: true,
        maxUpdatesPerMinute: 5,
        categoryMappings: {},
      },
    }),
  };

  const config = loadTelegramListingsConfig(env);
  assert.ok(config, "Telegram import config should load");
  const source = config.chats.get(chatId);
  assert.ok(source, "test Telegram chat should be allowlisted");
  return source;
}

function makeMessage(text) {
  return {
    message_id: 123,
    date: Math.floor(Date.now() / 1000),
    chat: {
      id: Number(chatId),
      type: "supergroup",
      username: "xoven_test_listings",
    },
    from: { id: senderId, is_bot: false },
    text,
  };
}

test("parses Polish/Ukrainian/Russian listing metadata and paid price", () => {
  const source = makeChatSource();
  const result = parseTelegramAdMessage(
      makeMessage([
        "Заголовок: Работа водителем в Польше",
        "Ищем водителя для постоянной работы. Опыт приветствуется, жильё обсуждается.",
        "Ціна: 120 PLN",
        "Тип предложения: paid",
        "Місто: Toruń",
        "Воєводство: Kujawsko-Pomorskie",
        "Телефон: +48 123 456 789",
      ].join("\n")),
      source,
  );

  assert.equal(result.title, "Работа водителем в Польше");
  assert.equal(result.category, "work");
  assert.equal(result.priceType, "paid");
  assert.equal(result.price, "120 zł");
  assert.equal(result.city, "Toruń");
  assert.equal(result.sellerContact, "+48 123 456 789");
  assert.equal(result.autoPublishEligible, true);
  assert.equal(result.decision, "auto_publish");
  assert.deepEqual(result.reviewReasons, []);
});

test("server evaluation sends uncertain listings to review and rejects parser failures", () => {
    const source = makeChatSource();
    const uncertain = evaluateTelegramAdMessage(
        makeMessage([
            "Продам тестовый товар",
            "Описание тестового объявления с достаточной длиной для разбора.",
            "Тип предложения: paid",
            "Місто: Toruń",
        ].join("\n")),
        source,
    );
    assert.equal(uncertain.decision, "needs_review");
    assert.ok(uncertain.parsed.reviewReasons.includes("voivodeship_missing"));

    const rejected = evaluateTelegramAdMessage(makeMessage("/start@XovenBoardPLBot"), source);
    assert.deepEqual(rejected, { decision: "reject", reason: "not_an_ad" });
});

test("infers the rent category from Polish/Ukrainian/Russian keywords", () => {
  const source = makeChatSource();
  const result = parseTelegramAdMessage(
      makeMessage([
        "Заголовок: Wynajmę mieszkanie w Toruniu",
        "Оренда квартири для сім'ї. Дві кімнати, кухня, ванна, близко до транспорта.",
        "Тип предложения: free",
        "Місто: Toruń",
      ].join("\n")),
      source,
  );

  assert.equal(result.category, "rent");
});

test("infers the service category from Polish/Ukrainian/Russian keywords", () => {
  const source = makeChatSource();
  const result = parseTelegramAdMessage(
      makeMessage([
        "Заголовок: Usługi remontowe",
        "Послуги з ремонту квартир: фарбування, шпаклювання та дрібні роботи.",
        "Тип предложения: exchange",
        "Місто: Toruń",
      ].join("\n")),
      source,
  );

  assert.equal(result.category, "service");
});

test("infers the sell category but requires an explicit offer type", () => {
    const source = makeChatSource();
    const result = parseTelegramAdMessage(
        makeMessage([
            "Продам дитячий велосипед",
            "Велосипед у хорошому стані, використовувався мало.",
            "Ціна: 200 PLN",
            "Місто: Toruń",
        ].join("\n")),
        source,
    );

    assert.equal(result.category, "sell");
    assert.equal(result.priceType, undefined);
    assert.equal(result.price, "200 zł");
    assert.equal(result.city, "Toruń");
    assert.ok(result.reviewReasons.includes("offer_type_unknown"));
    assert.equal(result.autoPublishEligible, false);
});

test("infers the rent category for car rental", () => {
    const source = makeChatSource();
    const result = parseTelegramAdMessage(
        makeMessage([
            "Wynajem samochodu w Toruniu",
            "Oferuję wynajem auta na dni i tygodnie. Stan bardzo dobry, kontakt telefoniczny.",
            "Цена: 150 PLN",
            "Тип предложения: paid",
            "Miasto: Toruń",
            "Województwo: Kujawsko-Pomorskie",
        ].join("\n")),
        source,
    );


    assert.equal(result.category, "rent");
    assert.equal(result.autoPublishEligible, true);
    assert.deepEqual(result.reviewReasons, []);
});


test("allows a paid listing without a numeric price", () => {
    const source = makeChatSource();
    const result = parseTelegramAdMessage(
        makeMessage([
            "Заголовок: Wynajem samochodu",
            "Oferuję wynajem samochodu w Toruniu. Stan bardzo dobry, kontakt telefoniczny.",
            "Тип предложения: paid",
            "Місто: Toruń",
        ].join("\n")),
        source,
    );

    assert.equal(result.category, "rent");
    assert.equal(result.priceType, "paid");
    assert.equal(result.price, undefined);
    assert.equal(result.reviewReasons.includes("paid_price_missing"), false);
});

test("rejects a high-confidence blocked account and SIM-card spam signal server-side", () => {
    const source = makeChatSource();
    const message = makeMessage([
        "Продам готовые банки",
        "Объявление с синтетическим описанием для проверки правил публикации.",
        "Тип предложения: paid",
    ].join("\n"));
    assert.throws(() => parseTelegramAdMessage(message, source), { message: "telegram-spam-rejected" });
    assert.equal(evaluateTelegramAdMessage(message, source).decision, "reject");
});


