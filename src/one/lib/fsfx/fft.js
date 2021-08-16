/*
 * Free FFT and convolution (JavaScript)
 *
 * Copyright (c) 2020 Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/free-small-fft-in-multiple-languages
 */

"use strict";

/*
 * Computes the discrete Fourier transform (DFT) of the given complex vector,
 * storing the result back into the vector.
 * The vector can have any length. This is a wrapper function.
 */
export function FFT(real, imag) {
	const n = real.length;
	if (n != imag.length) throw "Mismatched lengths";
	if (n == 0) {
		return;
	} else if ((n & (n - 1)) == 0) { // Is power of 2
		transformRadix2(real, imag);
	} else { // More complicated algorithm for arbitrary sizes
		transformBluestein(real, imag);
	}
}

/*
 * Computes the inverse discrete Fourier transform (IDFT) of the given complex
 * vector, storing the result back into the vector.
 * The vector can have any length. This is a wrapper function. This transform
 * does not perform scaling, so the inverse is not a true inverse.
 */
export function IFFT(real, imag) {
	FFT(imag, real);
}

/*
 * Computes the discrete Fourier transform (DFT) of the given complex vector,
 * storing the result back into the vector.
 * The vector's length must be a power of 2. Uses the Cooley-Tukey
 * decimation-in-time radix-2 algorithm.
 */
function transformRadix2(real, imag) {
	// Length variables
	const n = real.length;
	if (n != imag.length) throw "Mismatched lengths";
	if (n == 1) return; // Trivial transform

	let levels = -1;
	for (let i = 0; i < 32; i++) {
		if (1 << i == n) {
			levels = i;  // Equal to log2(n)
		}
	}
	if (levels == -1) throw "Length is not a power of 2";

	// Trigonometric tables
	const cosTable = new Float32Array(n / 2);
	const sinTable = new Float32Array(n / 2);
	for (let i = 0; i < n / 2; i++) {
		cosTable[i] = Math.cos(2 * Math.PI * i / n);
		sinTable[i] = Math.sin(2 * Math.PI * i / n);
	}

	// Bit-reversed addressing permutation
	for (let i = 0; i < n; i++) {
		const j = reverseBits(i, levels);
		if (j > i) {
			[real[i], real[j]] = [real[j], real[i]];
			[imag[i], imag[j]] = [imag[j], imag[i]];
		}
	}

	// Cooley-Tukey decimation-in-time radix-2 FFT
	for (let size = 2; size <= n; size *= 2) {
		const halfsize = size / 2;
		const tablestep = n / size;
		for (let i = 0; i < n; i += size) {
			for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
				const l = j + halfsize;
				const tpre =  real[l] * cosTable[k] + imag[l] * sinTable[k];
				const tpim = -real[l] * sinTable[k] + imag[l] * cosTable[k];
				real[l] = real[j] - tpre;
				imag[l] = imag[j] - tpim;
				real[j] += tpre;
				imag[j] += tpim;
			}
		}
	}

	// Returns the integer whose value is the reverse of the lowest 'width' bits
  // of the integer 'val'.
	function reverseBits(val, width) {
		let result = 0;
		for (let i = 0; i < width; i++) {
			result = (result << 1) | (val & 1);
			val >>>= 1;
		}
		return result;
	}
}


/*
 * Computes the discrete Fourier transform (DFT) of the given complex vector,
 * storing the result back into the vector.
 * The vector can have any length. This requires the convolution function,
 * which in turn requires the radix-2 FFT function.
 * Uses Bluestein's chirp z-transform algorithm.
 */
function transformBluestein(real, imag) {
	// Find a power-of-2 convolution length m such that m >= n * 2 + 1
	const n = real.length;
	if (n != imag.length) throw "Mismatched lengths";
	let m = 1;
	while (m < n * 2 + 1) {
		m *= 2;
	}

	// Trigonometric tables
	const cosTable = new Float32Array(n);
	const sinTable = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let j = i * i % (n * 2);  // This is more accurate than j = i * i
		cosTable[i] = Math.cos(Math.PI * j / n);
		sinTable[i] = Math.sin(Math.PI * j / n);
	}

	// Temporary vectors and preprocessing
	const areal = new Float32Array(m);
	const aimag = new Float32Array(m);
	for (let i = 0; i < n; i++) {
		areal[i] =  real[i] * cosTable[i] + imag[i] * sinTable[i];
		aimag[i] = -real[i] * sinTable[i] + imag[i] * cosTable[i];
	}
	const breal = new Float32Array(m);
	const bimag = new Float32Array(m);
	breal[0] = cosTable[0];
	bimag[0] = sinTable[0];
	for (let i = 1; i < n; i++) {
		breal[i] = breal[m - i] = cosTable[i];
		bimag[i] = bimag[m - i] = sinTable[i];
	}

	// Convolution
	convolveComplex(areal, aimag, breal, bimag);

	// Postprocessing
	for (let i = 0; i < n; i++) {
		real[i] =  areal[i] * cosTable[i] + aimag[i] * sinTable[i];
		imag[i] = -areal[i] * sinTable[i] + aimag[i] * cosTable[i];
	}
}


/*
 * Computes the circular convolution of the given real vectors. Each vector's
 * length must be the same.
 */
export function convolveReal(xvec, yvec) {
	const n = xvec.length;
	if (n != yvec.length) throw "Mismatched lengths";
	convolveComplex(
		xvec, new Float32Array(n),
		yvec, new Float32Array(n));
}


/*
 * Computes the circular convolution of the given complex vectors. Each
 * vector's length must be the same.
 */
function convolveComplex(xreal, ximag, yreal, yimag) {
	var n = xreal.length;
	if (n != ximag.length || n != yreal.length || n != yimag.length) {
		throw "Mismatched lengths";
	}

	FFT(xreal, ximag);
	FFT(yreal, yimag);

	for (let i = 0; i < n; i++) {
		const temp = xreal[i] * yreal[i] - ximag[i] * yimag[i];
		ximag[i] = ximag[i] * yreal[i] + xreal[i] * yimag[i];
		xreal[i] = temp;
	}
	IFFT(xreal, ximag);

  // Scaling (because this FFT implementation omits it)
	for (let i = 0; i < n; i++) {
		xreal[i] = xreal[i] / n;
		ximag[i] = ximag[i] / n;
	}
}
