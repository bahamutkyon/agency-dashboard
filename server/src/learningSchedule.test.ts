import { describe, it, expect, afterAll } from "vitest";
import {
  listLearningSchedules, getLearningSchedule,
  upsertLearningSchedule, deleteLearningSchedule, type LearningSchedule,
} from "./learningStore.js";

const ID = "lsched_test_1";

describe("learning schedule store", () => {
  afterAll(() => deleteLearningSchedule(ID));

  it("upsert 後可讀回，targets 正確序列化", () => {
    const s: LearningSchedule = {
      id: ID, name: "每週設計部",
      targets: [{ type: "category", id: "design" }],
      cron: "0 9 * * 1", enabled: true, createdAt: Date.now(),
    };
    upsertLearningSchedule(s);
    const got = getLearningSchedule(ID)!;
    expect(got.name).toBe("每週設計部");
    expect(got.targets).toEqual([{ type: "category", id: "design" }]);
    expect(got.enabled).toBe(true);
  });

  it("upsert 同 id 為更新（停用）", () => {
    const s = getLearningSchedule(ID)!;
    upsertLearningSchedule({ ...s, enabled: false });
    expect(getLearningSchedule(ID)!.enabled).toBe(false);
  });

  it("listLearningSchedules 含此排程", () => {
    expect(listLearningSchedules().some((x) => x.id === ID)).toBe(true);
  });

  it("delete 後讀不到", () => {
    deleteLearningSchedule(ID);
    expect(getLearningSchedule(ID)).toBeUndefined();
  });
});
