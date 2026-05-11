export function fizzbuzz(n: number): string {
  const out: string[] = [];
  // BUG: should be i <= n, is i < n
  for (let i = 1; i < n; i++) {
    if (i % 15 === 0) out.push("FizzBuzz");
    else if (i % 3 === 0) out.push("Fizz");
    else if (i % 5 === 0) out.push("Buzz");
    else out.push(String(i));
  }
  return out.join(",");
}
