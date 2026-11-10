import { renderTremorParity } from "./tremorParity";
import { describeEngineFixture } from "../../test/engineFixtures";

describeEngineFixture("The Tremor's kernel", "tremor", "tremorParity", renderTremorParity);
