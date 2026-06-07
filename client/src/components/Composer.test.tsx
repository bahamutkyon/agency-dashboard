import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Composer } from "./Composer";

const baseProps = (over: Partial<React.ComponentProps<typeof Composer>> = {}) => ({
  input: "",
  setInput: vi.fn(),
  inputRef: createRef<HTMLTextAreaElement>() as any,
  status: "idle",
  onSend: vi.fn(),
  showPicker: false,
  setShowPicker: vi.fn(),
  setPickerFilter: vi.fn(),
  visibleTemplates: [],
  insertTemplate: vi.fn(),
  notes: [],
  showNotePicker: false,
  setShowNotePicker: vi.fn(),
  attachNote: vi.fn(),
  ...over,
});

const textarea = () => screen.getByPlaceholderText(/跟這位員工說話/);

describe("Composer", () => {
  it("輸入文字呼叫 setInput", () => {
    const p = baseProps();
    render(<Composer {...p} />);
    fireEvent.change(textarea(), { target: { value: "嗨" } });
    expect(p.setInput).toHaveBeenCalledWith("嗨");
  });

  it('輸入 "/" 開啟範本選單', () => {
    const p = baseProps();
    render(<Composer {...p} />);
    fireEvent.change(textarea(), { target: { value: "/wf" } });
    expect(p.setShowPicker).toHaveBeenCalledWith(true);
    expect(p.setPickerFilter).toHaveBeenCalledWith("wf");
  });

  it("Enter(無 Shift)送出", () => {
    const p = baseProps({ input: "內容" });
    render(<Composer {...p} />);
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: false });
    expect(p.onSend).toHaveBeenCalled();
  });

  it("Shift+Enter 不送出(換行)", () => {
    const p = baseProps({ input: "內容" });
    render(<Composer {...p} />);
    fireEvent.keyDown(textarea(), { key: "Enter", shiftKey: true });
    expect(p.onSend).not.toHaveBeenCalled();
  });

  it("輸入為空時送出鈕停用", () => {
    render(<Composer {...baseProps({ input: "" })} />);
    expect(screen.getByText("送出")).toBeDisabled();
  });

  it("busy 狀態下 textarea 停用", () => {
    render(<Composer {...baseProps({ status: "busy", input: "x" })} />);
    expect(textarea()).toBeDisabled();
  });

  it("點範本呼叫 insertTemplate", () => {
    const p = baseProps({
      showPicker: true,
      visibleTemplates: [{ id: "t1", name: "範本一", body: "內文", agentId: null } as any],
    });
    render(<Composer {...p} />);
    fireEvent.click(screen.getByText("範本一"));
    expect(p.insertTemplate).toHaveBeenCalled();
  });
});
