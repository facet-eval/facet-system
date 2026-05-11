import { describe, it, expect } from "vitest";
import { fizzbuzz } from "../src/fizzbuzz";

describe("fizzbuzz", () => {
  it("returns the correct sequence up to and including n", () => {
    expect(fizzbuzz(15)).toBe(
      "1,2,Fizz,4,Buzz,Fizz,7,8,Fizz,Buzz,11,Fizz,13,14,FizzBuzz"
    );
  });

  it("handles n=1 correctly", () => {
    expect(fizzbuzz(1)).toBe("1");
  });
});
