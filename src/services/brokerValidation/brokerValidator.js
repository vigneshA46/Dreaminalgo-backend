import validateDhan from "./dhan.validator.js";
import validateAngel from "./angel.validator.js";
import validateAlice from "./alice.validator.js";
/* import validateZerodha from "./zerodha.validator.js";
import validateZebu from "./zebu.validator.js"; */

export const validateBrokerConnection = async (brokerName, credentials) => {

  switch (brokerName.toLowerCase()) {

    
    case "dhan":
      return await validateDhan(credentials);

    case "angelone":
      return await validateAngel(credentials);

    case "aliceblue":
      return await validateAlice(credentials);

/*     case "zerodha":
      return await validateZerodha(credentials);


    case "zebu mynt":
      return await validateZebu(credentials);
 */
    default:
      return {
        success: false,
        message: "Unsupported broker"
      };

  }

};