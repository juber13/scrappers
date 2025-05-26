import axios from "axios";

/**
 * Solves Google reCAPTCHA v2 using 2Captcha.
 * @param {string} sitekey - The sitekey from the reCAPTCHA iframe.
 * @param {string} pageUrl - The full URL of the page where reCAPTCHA is found.
 * @returns {Promise<string|null>} - Returns the CAPTCHA token or null on failure.
 */
const solveCaptcha = async (sitekey, pageUrl) => {
  const apiKey = process.env.TWO_CAPTCHA_API_KEY;

  try {
    // Submit CAPTCHA request
    const { data: submitData } = await axios.get("http://2captcha.com/in.php", {
      params: {
        key: apiKey,
        method: "userrecaptcha",
        googlekey: sitekey,
        pageurl: pageUrl,
        json: 1,
      },
    });

    if (submitData.status !== 1) {
      console.error("Failed to submit CAPTCHA:", submitData.request);
      return null;
    }

    const captchaId = submitData.request;
    console.log("Submitted CAPTCHA. Waiting for solution...");

    // Wait for solution to be ready
    for (let i = 0; i < 24; i++) {
      // up to 120 seconds
      await new Promise((res) => setTimeout(res, 5000));
      const { data: result } = await axios.get("http://2captcha.com/res.php", {
        params: {
          key: apiKey,
          action: "get",
          id: captchaId,
          json: 1,
        },
      });

      if (result.status === 1) {
        console.log("CAPTCHA solved.");
        return result.request;
      } else if (result.request !== "CAPCHA_NOT_READY") {
        console.error("Error retrieving CAPTCHA:", result.request);
        return null;
      }
    }

    console.error("CAPTCHA solving timed out.");
    return null;
  } catch (err) {
    console.error("Error solving CAPTCHA:", err.message);
    return null;
  }
};

export default solveCaptcha;
