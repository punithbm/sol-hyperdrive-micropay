import "react-toastify/dist/ReactToastify.css";
import "tailwindcss/tailwind.css";

import AccountAbstraction from "@safe-global/account-abstraction-kit-poc";
import { EthersAdapter, SafeAccountConfig, SafeFactory } from "@safe-global/protocol-kit";
import { GelatoRelayPack } from "@safe-global/relay-kit";
import { MetaTransactionData, MetaTransactionOptions, OperationType } from "@safe-global/safe-core-sdk-types";
import { initWasm } from "@trustwallet/wallet-core";
import { BigNumber } from "bignumber.js";
import { serializeError } from "eth-rpc-errors";
import { ethers } from "ethers";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import * as React from "react";
import { FC, useContext, useEffect, useMemo, useRef, useState } from "react";
import Confetti from "react-confetti";
import { toast } from "react-toastify";
import { ToastContainer } from "react-toastify";
import { parseEther } from "viem";

import { getBalance, getEstimatedGas, getNonce, getRelayTransactionStatus, getSendRawTransaction, getSendTransactionStatus, getUsdPrice } from "../apiServices";
import { GlobalContext } from "../context/GlobalContext";
import { decodeAddressHash, encryptAndEncodeHexStrings, getCurrencyFormattedNumber, getTokenValueFormatted, hexFormatter, hexToNumber, numHex } from "../utils";
import { Base } from "../utils/chain/base";
import { BaseGoerli } from "../utils/chain/baseGoerli";
import { icons } from "../utils/images";
import { useWagmi } from "../utils/wagmi/WagmiContext";
import { Wallet } from "../utils/wallet";
import { TRANSACTION_TYPE, TTranx } from "../utils/wallet/types";
import ClaimBtnModal from "./ClaimBtnModal";
import Footer from "./footer";
import { QRComponent } from "./loadchest/QRComponent";
import PrimaryBtn from "./PrimaryBtn";
import QrModal from "./QrModal";
import SecondaryBtn from "./SecondaryBtn";
import { ShareBtnModal } from "./ShareBtnModal";
import { IPaymaster, BiconomyPaymaster } from "@biconomy/paymaster";
import { IBundler, Bundler } from "@biconomy/bundler";
import { BiconomySmartAccount, BiconomySmartAccountV2, DEFAULT_ENTRYPOINT_ADDRESS, SmartAccount } from "@biconomy/account";
import { IHybridPaymaster, PaymasterMode, SponsorUserOperationDto } from "@biconomy/paymaster";

export interface IShareLink {
  uuid: string;
}

const ShareLink: FC<IShareLink> = (props) => {
  const { connect, baseGoerli, injectConnector, getAccount } = useWagmi();
  const {
    state: { isConnected },
  } = useContext(GlobalContext);
  const { uuid } = props;
  const [toAddress, setToAddress] = useState("");
  const [walletBalanceHex, setWalletBalanceHex] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [wallet, setWallet] = useState("" as unknown as Wallet);
  const [shareText, setShareText] = useState("Share");
  const [showShareIcon, setShowShareIcon] = useState(true);
  const [tokenValue, setTokenValue] = useState("");
  const [headingText, setHeadingText] = useState("Your Chest is ready to claim!");
  const [linkValueUsd, setLinkValueUsd] = useState("");
  const [isRedirected, setIsRedirected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [openClaimModal, setOpenClaimModal] = useState(false);
  const [openShareModal, setOpenShareModal] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [isClaimSuccessful, setIsClaimSuccessful] = useState(false);
  const [txHash, setTxHash] = useState("");
  const ethersProvider = new ethers.providers.JsonRpcProvider(BaseGoerli.info.rpc);
  const relayPack = new GelatoRelayPack(process.env.NEXT_PUBLIC_GELATO_RELAY_API_KEY);
  const options: MetaTransactionOptions = {
    gasLimit: "100000",
    isSponsored: true,
  };
  const router = useRouter();

  const [url, setUrl] = useState("");
  const shareData = {
    text: "Here is you Gifted Chest",
    url: typeof window !== "undefined" ? window.location.href : "",
  };

  const handleShareURL = () => {
    if (navigator?.share) {
      navigator
        .share(shareData)
        .then(() => console.log("Successfully shared"))
        .catch((error) => console.log("Error sharing", error));
    }
  };

  const copyAddress = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(fromAddress);
  };

  const copyToClipBoard = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(window.location.href);
    setShareText("Link Copied!");
    setShowShareIcon(false);
    setTimeout(() => {
      setShareText("Share");
      setShowShareIcon(true);
    }, 4000);
  };

  useMemo(async () => {
    if (uuid && uuid != "/[id]") {
      try {
        const walletCore = await initWasm();
        const wallet = new Wallet(walletCore);
        setWallet(wallet);
        const chars = uuid.split("~");
        if (chars.length < 1) {
          return;
        }
        const smartAccHash = chars[1];
        const smartAddress = decodeAddressHash(smartAccHash);
        if (smartAddress) {
          setFromAddress(smartAddress);
        } else {
          console.log("error", "invalid identifier");
        }
        handleSendToken();
        await fetchBalance(smartAddress);
      } catch (e) {
        router.push("/");
      }
    }
  }, [uuid]);

  const fetchBalance = async (address: string) => {
    const balance = (await getBalance(address)) as any;
    const hexValue = balance.result;
    const bgBal = BigNumber(hexValue);
    const bgNum = bgBal.dividedBy(Math.pow(10, 18)).toNumber();
    setWalletBalanceHex(hexValue);
    getUsdPrice().then(async (res: any) => {
      setTokenValue(getTokenValueFormatted(bgNum, 6, false));
      setIsLoading(false);
      const formatBal = bgNum * res.data.ethereum.usd;
      setLinkValueUsd(getCurrencyFormattedNumber(roundDownToTenth(formatBal), 2, "USD", true));
      const zeroBal = getCurrencyFormattedNumber(formatBal, 2, "USD", true) === "$0";
      setHeadingText(zeroBal ? "Chest have found their owner!" : "Your Chest is ready to claim!");
    });
  };

  const handleClaimClick = () => {
    setOpenClaimModal(true);
  };

  const handleCloseClaimModal = () => {
    setOpenClaimModal(false);
  };

  const handlePublicAddressTransaction = (toAdd: string) => {
    handleCloseClaimModal();
    sendToken(toAdd);
  };

  const handleConnect = async () => {
    const account = await getAccount();
    if (account.isConnected) {
      setToAddress(account.address);
      handleCloseClaimModal();
      sendToken(account.address);
    } else {
      try {
        const result = await connect({
          chainId: baseGoerli.id,
          connector: injectConnector,
        });
        setToAddress(result.account);
        toast.success(`Please wait, wallet connected and claim initiated for the chest`);
        handleCloseClaimModal();
        sendToken(result.account);
      } catch (e: any) {
        const err = serializeError(e);
        console.log(err, "err");
        setProcessing(false);
        toast.error(e.message);
      }
    }
  };

  // const [safeAccountAbstraction, setSafeAccountAbstraction] =
  //     useState<AccountAbstraction>();
  const isRelayInitiated = useRef(false);
  const safeAccountAbstraction = useRef<AccountAbstraction>();
  const bicomomySmartAcc = useRef<BiconomySmartAccount>();

  const handleSendToken = async () => {
    const walletCore = await initWasm();
    const wallet = new Wallet(walletCore);
    const chars = uuid.split("~");
    if (chars.length < 1) {
      return;
    }
    const eoaHash = chars[0];
    const fromKey = await wallet.getAccountFromPayLink(eoaHash);

    // from signer address
    const fromSigner = new ethers.Wallet(fromKey.key, ethersProvider);

    const paymaster = new BiconomyPaymaster({
      paymasterUrl: "https://paymaster.biconomy.io/api/v1/84531/76v47JPQ6.7a881a9f-4cec-45e0-95e9-c39c71ca54f4",
    });

    const bundler: IBundler = new Bundler({
      bundlerUrl: "https://bundler.biconomy.io/api/v2/84531/nJPK7B3ru.dd7f7861-190d-41bd-af80-6877f74b8f44",
      chainId: 84531,
      entryPointAddress: DEFAULT_ENTRYPOINT_ADDRESS,
    });
    let biWallet = new BiconomySmartAccount({
      signer: fromSigner,
      chainId: 84531,
      bundler: bundler,
      paymaster: paymaster,
    });
    biWallet = await biWallet.init({
      accountIndex: 0,
    });
    bicomomySmartAcc.current = biWallet;
  };

  const sendToken = async (toAdd: string) => {
    setProcessing(true);
    try {
      if (bicomomySmartAcc.current) {
        const amountValue = hexToNumber(walletBalanceHex) / Math.pow(10, 18);
        const data = "0x";
        const tx = {
          to: toAdd,
          value: parseEther(amountValue.toString()).toString(),
          data,
        };
        const smartAccount = bicomomySmartAcc;
        let partialUserOp = await smartAccount.current?.buildUserOp([tx]);
        const biconomyPaymaster = smartAccount.current?.paymaster as IHybridPaymaster<SponsorUserOperationDto>;
        let paymasterServiceData: SponsorUserOperationDto = {
          mode: PaymasterMode.SPONSORED,
          // optional params...
        };

        try {
          // setChestLoadingText("Setting up paymaster...");
          const paymasterAndDataResponse = await biconomyPaymaster.getPaymasterAndData(partialUserOp!, paymasterServiceData);
          partialUserOp!.paymasterAndData = paymasterAndDataResponse.paymasterAndData;

          const userOpResponse = await smartAccount.current?.sendUserOp(partialUserOp!);
          const transactionDetails = await userOpResponse?.wait();
          handleTransactionStatus(transactionDetails?.receipt.transactionHash ?? "");
        } catch (error) {
          console.error("Error executing transaction:", error);
        }
      }
    } catch (e: any) {
      setProcessing(false);
      toast.error(e.message);
    }
  };

  const handleTransactionStatus = (hash: string) => {
    const intervalInMilliseconds = 2000;
    const interval = setInterval(() => {
      getSendTransactionStatus(hash)
        .then((res: any) => {
          if (res.result) {
            const status = Number(res.result.status);
            if (status === 1) {
              setLinkValueUsd("$0");
              setTokenValue("0");
              setTxHash(hash);
              setHeadingText("Chest have found their owner!");
              handleClaimSuccess();
            } else {
              setProcessing(false);
              toast.error("Failed to Claim Amount. Try Again");
            }
            if (interval !== null) {
              clearInterval(interval);
            }
          }
        })
        .catch((e) => {
          setProcessing(false);
          const err = serializeError(e);
          toast.error(err.message);
          console.log(e, "error");
        });
    }, intervalInMilliseconds);
  };


  const handleClaimSuccess = () => {
    setIsClaimSuccessful(true);
    setProcessing(false);
    toast.success(
      <>
        <p>Claimed Successfully!</p>
      </>
    );
  };

  useEffect(() => {
    if (window.history.length <= 2) {
      setIsRedirected(false);
    } else {
      setIsRedirected(true);
    }
    setUrl(window.location.href);
  }, []);

  const handleDisableBtn = () => {
    if (!isLoading && linkValueUsd !== "$0") {
      return false;
    } else {
      return true;
    }
  };

  const roundDownToTenth = (number: number) => {
    const decimalPart = number - Math.floor(number);
    if (decimalPart < 0.7) {
      return Math.round(number * 10) / 10;
    } else {
      return Math.ceil(number);
    }
  };

  return (
    <div className="w-full h-screen relative flex items-center overflow-hidden">
      <ToastContainer toastStyle={{ backgroundColor: "#282B30" }} className={`w-50`} style={{ width: "600px" }} position="bottom-center" autoClose={6000} hideProgressBar={true} newestOnTop={false} closeOnClick rtl={false} theme="dark" />
      <div className="w-full h-[70%] text-center p-4  flex flex-col gap-5 items-center">
        {!processing && <p className="text-black text-[20px] font-bold">{headingText}</p>}

        <div className="w-full md:w-[60%] max-w-[450px] h-[220px] shareLinkBg mb-10 cardShine">
          <div className=" rounded-lg profileBackgroundImage flex justify-between h-full">
            {isLoading ? (
              <div className="w-full h-full mt-5 ml-5">
                <div className="w-[15%] h-[20%] bg-white/10 animate-pulse rounded-lg mb-2"></div>
                <div className="w-[10%] h-[12%] bg-white/10 animate-pulse rounded-lg "></div>
              </div>
            ) : (
              <div className="flex justify-between">
                <div className="flex gap-1 flex-col text-start ml-3">
                  <p className="text-[40px] text-white font bold">{`${linkValueUsd}`}</p>
                  <p className="text-sm text-white/80">{`~ ${tokenValue} ETH`}</p>
                  <div className="flex justify-around w-[100px] mx-auto mt-1.5">
                    <Link href={`https://goerli.basescan.org/address/${fromAddress}/#internaltx`} target="_blank">
                      <Image src={icons.linkWhite} alt="external link" className="w-5 cursor-pointer opacity-80 hover:opacity-100" />
                    </Link>

                    <Image
                      src={icons.qrWhite}
                      alt="show qr code"
                      className="w-5 cursor-pointer opacity-80 hover:opacity-100"
                      onClick={() => {
                        setShowQr(!showQr);
                      }}
                    />
                    <Image src={icons.copyIconWhite} alt="copy address" className="w-5 cursor-pointer opacity-80 hover:opacity-100" onClick={copyAddress} />
                  </div>
                </div>
              </div>
            )}
            <div className="self-end w-[45%]">{isClaimSuccessful || linkValueUsd === "$0" ? <Image className="mt-[-29px]" src={icons.tchestopen} alt="Chest Open" /> : <Image className="" src={icons.shareLinkTChest} alt="Chest" />}</div>
          </div>
        </div>
        {linkValueUsd === "$0" ? (
          txHash ? (
            <div className={`py-4 text-black support_text_bold font-normal rounded-lg flex gap-1 items-center w-full justify-center border custom-shadow-sm border-black max-w-[450px] mx-auto`}>
              <div>
                <p>🎉 Claim successful!</p>
                <p className="mt-3">
                  {" "}
                  The treasure is now yours to behold!
                  <a target="_blank" href={`https://goerli.basescan.org/tx/${txHash}`} rel="noreferrer" className="underline ml-2">
                    {"View ->"}
                  </a>
                </p>
              </div>
            </div>
          ) : null
        ) : isRedirected ? (
          <>
            {!processing && (
              <div className="lg:hidden block w-full">
                <PrimaryBtn
                  className={`${handleDisableBtn() ? "opacity-60" : "opacity-100"}`}
                  title="Share"
                  onClick={() => {
                    handleShareURL();
                  }}
                  rightImage={showShareIcon ? icons.shareBtnIcon : ""}
                  showShareIcon={showShareIcon}
                  btnDisable={handleDisableBtn()}
                  loading={isLoading}
                />
              </div>
            )}
            {!processing && (
              <div className="hidden lg:block w-full max-w-[400px]">
                <PrimaryBtn
                  className={`${handleDisableBtn() ? "opacity-60" : "opacity-100"}`}
                  title={shareText}
                  onClick={() => {
                    setOpenShareModal(true);
                  }}
                  rightImage={showShareIcon ? icons.shareBtnIcon : ""}
                  btnDisable={handleDisableBtn()}
                  loading={isLoading}
                />
              </div>
            )}
            <SecondaryBtn className={`${handleDisableBtn() ? "opacity-60" : "opacity-100"}`} title={"Claim"} onClick={() => handleClaimClick()} rightImage={processing ? undefined : icons.downloadBtnIconBlack} btnDisable={handleDisableBtn()} loading={isLoading || processing} />
            {processing && <p className="claim-processing">{"⏳ Hang tight! We're currently processing your claim."}</p>}
          </>
        ) : (
          <>
            <PrimaryBtn className={`${handleDisableBtn() ? "opacity-60" : "opacity-100"}`} title={"Claim"} onClick={() => handleClaimClick()} rightImage={processing ? undefined : icons.downloadBtnIconBlack} btnDisable={handleDisableBtn()} loading={isLoading || processing} />

            {processing && <p className="claim-processing">{"⏳ Hang tight! We're currently processing your claim."}</p>}
            {!processing && (
              <div className="lg:hidden block w-full">
                <SecondaryBtn
                  className={`${handleDisableBtn() ? "opacity-60" : "opacity-100"}`}
                  title="Share"
                  onClick={() => {
                    handleShareURL();
                  }}
                  rightImage={showShareIcon ? icons.shareBtnIconWhite : ""}
                  showShareIcon={showShareIcon}
                  btnDisable={handleDisableBtn()}
                  loading={isLoading}
                />
              </div>
            )}
            {!processing && (
              <div className="hidden lg:block w-full max-w-[400px]">
                <SecondaryBtn
                  className={`${handleDisableBtn() ? "opacity-60" : "opacity-100"}`}
                  title={shareText}
                  onClick={() => {
                    setOpenShareModal(true);
                  }}
                  rightImage={showShareIcon ? icons.shareBtnIconWhite : ""}
                  btnDisable={handleDisableBtn()}
                  loading={isLoading}
                />
              </div>
            )}
          </>
        )}
      </div>
      <ClaimBtnModal open={openClaimModal} setOpen={setOpenClaimModal} uuid={uuid} handleConnect={handleConnect} handlePublicAddressTransaction={handlePublicAddressTransaction} />
      <ShareBtnModal open={openShareModal} setOpen={setOpenShareModal} />
      <QrModal open={showQr} setOpen={setShowQr} address={fromAddress} />
      {isClaimSuccessful && <Confetti width={2400} height={1200} recycle={false} numberOfPieces={2000} />}

      {/* <Footer /> */}
    </div>
  );
};
export default ShareLink;
