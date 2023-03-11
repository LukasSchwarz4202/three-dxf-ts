// This is based on the three-dxf library's (https://github.com/gdsestimating/three-dxf) file
// https://github.com/gdsestimating/three-dxf/blob/master/src/round10.js
// Copyright (c) 2015 GDS Storefront Estimating
// which is based on the example code found from:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/floor
// Example code on MDN is public domain or CC0 (your preference) or MIT depending when the
// example code was added: https://developer.mozilla.org/en-US/docs/MDN/About

const round10 = (value: number, exp: number | undefined): number => {
  // If the exp is undefined or zero...
  if (exp === undefined || exp === 0) {
    return Math.round(value);
  }

  // If the value is not a number or the exp is not an integer...
  if (isNaN(value) || exp % 1 !== 0) {
    return NaN;
  }

  // Shift
  const valueStringParts: string[] = value.toString().split("e");
  const shiftedValue: number = Math.round(
    +(valueStringParts[0] + "e" + (valueStringParts[1] ? +valueStringParts[1] - exp : -exp))
  );

  // Shift back
  const shiftedValueStringParts: string[] = shiftedValue.toString().split("e");
  return +(shiftedValueStringParts[0] + "e" + (shiftedValueStringParts[1] ? +shiftedValueStringParts[1] + exp : exp));
};

export default round10;
