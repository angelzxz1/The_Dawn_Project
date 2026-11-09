import { renderCrusherParity } from "./crusherParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Crusher's kernel", "crusher", "crusherParity", renderCrusherParity);
