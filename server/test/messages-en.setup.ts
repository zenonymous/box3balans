import { useMessageLanguage } from "../src/i18n/index.js";

// Tests read server messages in English; test/i18n.test.ts checks the Dutch ones.
useMessageLanguage("en");
