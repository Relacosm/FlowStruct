// samples.js — quick-load snippets so the tool never opens empty
export const SAMPLES = {
  python: `def classify(scores):
    total = 0
    for s in scores:
        if s < 0:
            continue
        elif s > 100:
            break
        else:
            total += s
    if total > 500:
        return "high"
    while total > 0:
        total -= 50
    return "low"`,

  javascript: `function processOrder(order) {
  if (!order.items.length) {
    return "empty";
  }
  let cost = 0;
  for (const item of order.items) {
    if (item.price > 1000) {
      cost += item.price * 0.9;
    } else {
      cost += item.price;
    }
  }
  try {
    charge(order.card, cost);
  } catch (err) {
    return "declined";
  }
  return "ok";
}`,

  java: `public int findMax(int[] nums) {
  if (nums.length == 0) {
    return -1;
  }
  int max = nums[0];
  for (int i = 1; i < nums.length; i++) {
    if (nums[i] > max) {
      max = nums[i];
    }
  }
  return max;
}`,

  ruby: `def grade(score)
  if score >= 90
    return "A"
  elsif score >= 80
    return "B"
  else
    puts "needs work"
  end
  attempts.each do |a|
    next if a.skipped
    puts a.value
  end
end`,
};
